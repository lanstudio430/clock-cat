import { ApiError, callApi } from './api';
import { buildWeeks, formatNumber, goalMet, monthKeyOf, monthTotal, shiftMonthKey, validateEntry, workedHours } from './calc';
import { applyOp, describeOp, fromServer, opMonth, type ServerMonth } from './ops';
import {
  computePay, defaultCatalog, normalizeCatalog, normalizeMonthPay, normalizePayData, resolveMonthPay, validateCatalog,
  validateMonthPay,
} from './pay';
import { KEYS, MAIN_PROFILE, keysFor, store, type ProfileKeys } from './storage';
import type { Entry, MonthData, MonthPay, Op, PayCatalog, Profile, RemoteUser, Settings } from './types';

export const API_URL_PATTERN = /^https:\/\/script\.google\.com\/.+\/exec$/;
export const MAX_REQUIRED_HOURS = 744;
export const MAX_PROFILE_NAME = 20;
/** 第一位使用者的預設名稱 */
export const DEFAULT_PROFILE_NAME = '我';
const STALE_AFTER_MS = 30_000;
const TOAST_MS = 3_000;

export type StampTone = 'ok' | 'sync' | 'warn' | 'bad';
export interface Stamp {
  tone: StampTone;
  text: string;
  action?: 'retry' | 'settings';
}
export interface Toast {
  id: number;
  tone: 'ok' | 'bad';
  text: string;
}

interface ProfileList {
  active: string;
  list: Profile[];
}

const isSettings = (value: unknown): value is Settings =>
  Boolean(value) && typeof (value as Settings).url === 'string' && typeof (value as Settings).key === 'string';

const isProfile = (value: unknown): value is Profile =>
  isSettings(value) && typeof (value as Profile).id === 'string' && typeof (value as Profile).name === 'string';

/**
 * 這台裝置上的使用者。舊版只有一組連線設定：第一次升級時變成第一位使用者，
 * 它沿用舊的鍵名，所以快取、待同步變更和薪資設定都不用搬。
 */
function readProfiles(): ProfileList {
  const saved = store.get<ProfileList>(KEYS.profiles);
  const list = Array.isArray(saved?.list) ? saved.list.filter(isProfile) : [];
  if (list.length) return { active: list.some((p) => p.id === saved!.active) ? saved!.active : list[0].id, list };

  const legacy = store.get<Settings>(KEYS.settings);
  if (!isSettings(legacy)) return { active: MAIN_PROFILE, list: [] };
  const migrated = { active: MAIN_PROFILE, list: [{ id: MAIN_PROFILE, name: DEFAULT_PROFILE_NAME, url: legacy.url, key: legacy.key }] };
  store.set(KEYS.profiles, migrated);
  return migrated;
}

function readQueue(keys: ProfileKeys): Op[] {
  const saved = store.get<Op[]>(keys.queue);
  return Array.isArray(saved) ? saved : [];
}

function clearProfileStorage(keys: ProfileKeys) {
  store.remove(keys.queue);
  store.remove(keys.pay);
  store.removeWithPrefix(keys.monthPrefix);
}

const newProfileId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const initialProfiles = readProfiles();
const initialPay = normalizePayData(store.get(keysFor(initialProfiles.active).pay));

/** 薪資設定的變更：整份取代，重送沒關係 */
const isPayOp = (op: Op) => op.type === 'savePayCatalog' || op.type === 'savePayMonth';
const DEFAULT_CATALOG = defaultCatalog();
const monthName = (monthKey: string) => `${Number(monthKey.slice(5))} 月`;

const asApiError = (error: unknown) =>
  error instanceof ApiError ? error : new ApiError('offline', String(error), '連不上');

/**
 * 整個 App 的狀態。資料流與 v1.1.0 相同：
 * 先顯示本機快取 → 變更先改畫面、排進佇列 → 依序送到試算表 → 抓前後一個月更新快取。
 */
export class AppState {
  year = $state(new Date().getFullYear());
  month = $state(new Date().getMonth());
  /** 這台裝置上的使用者，以及現在用的是哪一位 */
  profiles = $state<Profile[]>(initialProfiles.list);
  profileId = $state(initialProfiles.active);
  queue = $state<Op[]>(readQueue(keysFor(initialProfiles.active)));
  months = $state<Record<string, MonthData | null>>({});
  loading = $state<'' | 'loading' | 'updating'>('');
  loadError = $state<ApiError | null>(null);
  syncError = $state<ApiError | null>(null);
  syncing = $state(false);
  editing = $state<string | null>(null);
  settingsOpen = $state(false);
  /** 正在編輯哪個月的薪資設定；沒有打開時是 null */
  payDialogMonth = $state<string | null>(null);
  categoriesOpen = $state(false);
  /** 每個月各自的薪資設定（key 是 yyyy-MM）。以試算表為準，本機只是快取 */
  payMonths = $state<Record<string, MonthPay>>(initialPay.months);
  /** 使用者自訂過的常用類別；還沒自訂過是 null，使用內建的預設 */
  customCatalog = $state<PayCatalog | null>(initialPay.catalog);
  /** 後端還沒更新（不認得薪資設定的動作）時，薪資設定只存在這台裝置 */
  payBackend = $state<'unknown' | 'ok' | 'unsupported'>('unknown');
  /** 後端認不認得多使用者的動作；還沒更新的後端不能在 App 裡建立使用者 */
  accountBackend = $state<'unknown' | 'ok' | 'unsupported'>('unknown');
  toast = $state<Toast | null>(null);
  celebrate = $state(0);

  #requestId = 0;
  /** 每次切換使用者就加一；切換前發出的請求回來時，結果不採用 */
  #epoch = 0;
  #syncedOps = 0;
  #lastRefresh = 0;
  #flushing: Promise<void> | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  #toastId = 0;

  get profile(): Profile | null {
    return this.profiles.find((profile) => profile.id === this.profileId) ?? null;
  }
  get settings(): Settings | null {
    const profile = this.profile;
    return profile ? { url: profile.url, key: profile.key } : null;
  }
  get #keys() {
    return keysFor(this.profileId);
  }
  get monthKey() {
    return monthKeyOf(this.year, this.month);
  }
  get data(): MonthData | null {
    return this.months[this.monthKey] ?? null;
  }
  get ready() {
    return this.data !== null;
  }
  get entries(): Record<string, Entry> {
    return this.data?.entries ?? {};
  }
  get requiredHours() {
    return this.data?.requiredHours ?? null;
  }
  get weeks() {
    return buildWeeks(this.year, this.month, this.entries);
  }
  get total() {
    return monthTotal(this.weeks);
  }
  get catalog(): PayCatalog {
    return this.customCatalog ?? DEFAULT_CATALOG;
  }
  /** 這個月用哪一份薪資設定：自己的、沿用前面月份的，或還沒設定（null） */
  get payResolved() {
    return resolveMonthPay(this.payMonths, this.monthKey);
  }
  /** 這個月的薪資試算；還沒設定薪資或月份還沒載入時是 null */
  get pay() {
    const resolved = this.payResolved;
    return resolved && this.ready ? computePay(resolved.pay, this.entries, this.requiredHours) : null;
  }
  get isConfigured() {
    return Boolean(this.settings?.url && this.settings?.key);
  }
  /** 這個月沒有快取又載入失敗：用錯誤卡取代本月卡。 */
  get showErrorCard() {
    return !this.ready && this.loadError !== null;
  }
  get configProblem() {
    const error = this.syncError ?? this.loadError;
    return error?.kind === 'config' ? error.message : '';
  }

  get stamp(): Stamp {
    const pending = this.queue.length;
    const error = this.syncError ?? this.loadError;
    if (!this.isConfigured) return { tone: 'bad', text: '尚未設定連線', action: 'settings' };
    if (error?.kind === 'config') return { tone: 'bad', text: error.short, action: 'settings' };
    if (error && pending) return { tone: 'warn', text: `離線・${pending} 筆待同步`, action: 'retry' };
    if (error) return { tone: 'warn', text: '顯示上次的資料', action: 'retry' };
    if (this.loading || this.syncing || pending) return { tone: 'sync', text: '同步中' };
    return { tone: 'ok', text: '已同步' };
  }

  // ---- 導覽 ----

  start() {
    if (!this.isConfigured) this.settingsOpen = true;
    void this.load();
  }

  goTo(year: number, month: number) {
    const target = new Date(year, month, 1);
    this.year = target.getFullYear();
    this.month = target.getMonth();
    this.editing = null;
    void this.load();
  }

  goToday() {
    const today = new Date();
    this.goTo(today.getFullYear(), today.getMonth());
  }

  refreshIfStale() {
    if (Date.now() - this.#lastRefresh > STALE_AFTER_MS) void this.load({ quiet: true });
  }

  // ---- 快取 ----

  #ensure(key: string) {
    if (key in this.months) return;
    const saved = store.get<MonthData>(this.#keys.monthPrefix + key);
    this.months[key] = saved && saved.entries ? saved : null;
  }

  #putMonth(key: string, data: MonthData) {
    this.months[key] = data;
    store.set(this.#keys.monthPrefix + key, $state.snapshot(data));
  }

  #persistQueue() {
    store.set(this.#keys.queue, $state.snapshot(this.queue));
  }

  // ---- 載入 ----

  async load({ quiet = false } = {}) {
    const requestId = ++this.#requestId;
    const key = this.monthKey;
    this.#ensure(key);
    this.loadError = null;
    this.loading = this.ready ? (quiet ? '' : 'updating') : 'loading';
    if (!this.isConfigured) {
      this.loading = '';
      return;
    }

    try {
      await this.#refreshMonths(key);
    } catch (error) {
      // 只採用最新一次請求的結果，避免快速切換月份時被舊的覆蓋
      if (requestId !== this.#requestId) return;
      this.loading = '';
      this.loadError = asApiError(error);
      return;
    }
    if (requestId !== this.#requestId) return;
    this.loading = '';
  }

  // 先送出待處理的變更，再抓前後各一個月，之後切換月份就不用等
  async #refreshMonths(centerKey: string) {
    const epoch = this.#epoch;
    await this.flushQueue();
    if (epoch !== this.#epoch) return;

    const keys = [shiftMonthKey(centerKey, -1), centerKey, shiftMonthKey(centerKey, 1)];
    let months: Record<string, ServerMonth> = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      const syncedBefore = this.#syncedOps;
      months = await callApi<Record<string, ServerMonth>>(this.settings!, 'getMonths', { months: keys });
      if (epoch !== this.#epoch) return;
      // 抓取期間有變更完成，結果可能是舊的，再抓一次
      if (syncedBefore === this.#syncedOps) break;
    }

    for (const key of keys) {
      if (!months[key]) continue;
      const data = fromServer(months[key]);
      this.queue.filter((op) => opMonth(op) === key).forEach((op) => applyOp(data, op));
      this.#putMonth(key, data);
    }
    this.#lastRefresh = Date.now();
    await this.#refreshPay(epoch);
    await this.#refreshAccount(epoch);
  }

  /** 問後端這把密鑰是不是管理員；每位使用者切換進來時問一次就好 */
  async #refreshAccount(epoch: number) {
    if (this.accountBackend !== 'unknown') return;
    try {
      const account = await callApi<{ admin: boolean }>(this.settings!, 'getAccount', {});
      if (epoch !== this.#epoch) return;
      this.accountBackend = 'ok';
      this.#updateProfile(this.profileId, { admin: account?.admin === true });
    } catch (error) {
      if (epoch !== this.#epoch) return;
      if (error instanceof ApiError && error.code === 'bad_request') this.accountBackend = 'unsupported';
    }
  }

  /** 以試算表的薪資設定為準；失敗不影響月曆，下次再試。 */
  async #refreshPay(epoch: number) {
    if (this.payBackend === 'unsupported' || this.queue.some(isPayOp)) return;
    const syncedBefore = this.#syncedOps;
    try {
      const raw = await callApi<unknown>(this.settings!, 'getPayData', {});
      if (epoch !== this.#epoch) return;
      this.payBackend = 'ok';
      // 抓取期間本機又改了設定，這份是舊的，不要蓋掉
      if (syncedBefore !== this.#syncedOps || this.queue.some(isPayOp)) return;

      const remote = normalizePayData(raw);
      const remoteEmpty = remote.catalog === null && Object.keys(remote.months).length === 0;
      const localHas = this.customCatalog !== null || Object.keys(this.payMonths).length > 0;
      if (remoteEmpty && localHas) {
        // 試算表還沒有薪資設定（例如先在本機設定、之後才連線），把本機的送上去
        if (this.customCatalog) this.queue.push({ type: 'savePayCatalog', catalog: $state.snapshot(this.customCatalog) });
        for (const [month, pay] of Object.entries(this.payMonths)) {
          this.queue.push({ type: 'savePayMonth', month, pay: $state.snapshot(pay) });
        }
        this.#persistQueue();
        void this.flushQueue();
        return;
      }
      this.customCatalog = remote.catalog;
      this.payMonths = remote.months;
      this.#persistPay();
    } catch (error) {
      if (epoch !== this.#epoch) return;
      if (error instanceof ApiError && error.code === 'bad_request') this.payBackend = 'unsupported';
    }
  }

  #persistPay() {
    store.set(this.#keys.pay, { catalog: $state.snapshot(this.customCatalog), months: $state.snapshot(this.payMonths) });
  }

  // ---- 變更與同步 ----

  #commit(op: Exclude<Op, { type: 'savePayCatalog' | 'savePayMonth' }>) {
    const key = opMonth(op)!;
    this.#ensure(key);
    const data = this.months[key];
    const metBefore = key === this.monthKey && goalMet(this.total, this.requiredHours);
    if (data) {
      applyOp(data, op);
      this.#putMonth(key, data);
    }
    this.queue.push(op);
    this.#persistQueue();
    if (key === this.monthKey && !metBefore && goalMet(this.total, this.requiredHours)) this.celebrate++;
    void this.flushQueue();
  }

  /** 依序送出佇列；同一時間只會有一個在跑。不會 reject，失敗記在 syncError。 */
  flushQueue(): Promise<void> {
    if (!this.#flushing) {
      this.syncing = true;
      const run: Promise<void> = this.#runQueue(this.#epoch).finally(() => {
        // 中途切換了使用者時，新的使用者可能已經開始自己的同步，不要動它
        if (this.#flushing !== run) return;
        this.#flushing = null;
        this.syncing = false;
      });
      this.#flushing = run;
    }
    return this.#flushing;
  }

  async #runQueue(epoch: number) {
    while (this.queue.length && this.isConfigured) {
      const op = $state.snapshot(this.queue[0]) as Op;
      try {
        await this.#send(op);
      } catch (error) {
        // 已經換成別的使用者：這筆還留在原本那位的佇列裡，換回去時再送
        if (epoch !== this.#epoch) return;
        const apiError = asApiError(error);
        if (isPayOp(op) && apiError.code === 'bad_request') {
          // 後端還沒更新到有薪資設定的版本：設定留在這台裝置，別卡住其他變更
          this.queue.shift();
          this.#persistQueue();
          this.payBackend = 'unsupported';
          this.showToast('後端還沒更新，薪資設定只存在這台裝置。請到 Apps Script 重新部署新版本', 'bad');
          continue;
        }
        if (apiError.kind !== 'rejected') {
          // 變更留在佇列，之後再試
          this.syncError = apiError;
          return;
        }
        // 試算表明確拒絕：丟掉這筆，並用試算表的內容還原畫面
        this.queue.shift();
        this.#persistQueue();
        this.showToast(`${describeOp(op)}沒存到：${apiError.message}`, 'bad');
        void this.load({ quiet: true });
        continue;
      }
      // 已經送到了，但佇列換成別的使用者的；原本那位換回去時會再送一次，重送不會出錯
      if (epoch !== this.#epoch) return;
      this.queue.shift();
      this.#persistQueue();
      this.#syncedOps++;
    }
    this.syncError = null;
  }

  #send(op: Op) {
    const settings = this.settings!;
    if (op.type === 'saveEntry') return callApi(settings, 'saveEntry', { entry: op.entry });
    if (op.type === 'deleteEntry') return callApi(settings, 'deleteEntry', { date: op.date });
    if (op.type === 'savePayCatalog') return callApi(settings, 'savePayCatalog', { catalog: op.catalog });
    if (op.type === 'savePayMonth') return callApi(settings, 'savePayMonth', { month: op.month, pay: op.pay });
    return callApi(settings, 'saveRequiredHours', { month: op.month, value: op.value });
  }

  retry() {
    void this.load();
  }

  // ---- 編輯 ----

  open(date: string) {
    if (this.ready) this.editing = date;
  }

  close() {
    this.editing = null;
  }

  /** 儲存一天的紀錄；不合規則時回傳錯誤訊息，面板保持開著。 */
  saveEntry(entry: Entry): string {
    const message = validateEntry(entry);
    if (message) return message;
    this.#commit({ type: 'saveEntry', entry });
    this.editing = null;
    const [, month, day] = entry.date.split('-').map(Number);
    const hours = workedHours(entry);
    this.showToast(`記下了！${month}月${day}日 ${hours ? `${formatNumber(hours)}h` : entry.dayType}`, 'ok');
    return '';
  }

  deleteEntry(date: string) {
    this.#commit({ type: 'deleteEntry', date });
    this.editing = null;
    const [, month, day] = date.split('-').map(Number);
    this.showToast(`刪除了 ${month}月${day}日`, 'ok');
  }

  /** 儲存應上班時數；不合規則時回傳錯誤訊息，畫面上的值由呼叫端改回。 */
  saveRequired(text: string, badInput: boolean): string {
    if (!this.ready) return '';
    if (badInput) return '請輸入數字';
    const isBlank = text.trim() === '';
    const value = isBlank ? null : Number(text);
    if (value !== null && !(value >= 0 && value <= MAX_REQUIRED_HOURS)) {
      return `${text} 超出 0～${MAX_REQUIRED_HOURS}，已改回 ${this.requiredHours ?? '空白'}`;
    }
    if (value === this.requiredHours) return '';
    this.#commit({ type: 'saveRequired', month: this.monthKey, value });
    return '';
  }

  // ---- 薪資設定 ----

  /** 打開目前這個月的薪資設定 */
  openPayDialog() {
    this.payDialogMonth = this.monthKey;
  }

  closePayDialog() {
    this.payDialogMonth = null;
  }

  openCategories() {
    this.categoriesOpen = true;
  }

  closeCategories() {
    this.categoriesOpen = false;
  }

  /** 儲存某個月的薪資設定。從這個月起生效，不會動到更早的月份。不合規則時回傳錯誤訊息。 */
  savePayMonth(draft: MonthPay): string {
    const message = validateMonthPay(draft);
    if (message) return message;
    const month = this.payDialogMonth ?? this.monthKey;
    const pay = normalizeMonthPay(JSON.parse(JSON.stringify(draft)))!;
    this.payMonths[month] = pay;
    this.#persistPay();
    this.payDialogMonth = null;
    this.#syncPay({ type: 'savePayMonth', month, pay }, `${monthName(month)}薪資設定已儲存`);
    return '';
  }

  /** 清除這個月自己的設定，改回沿用前面的月份 */
  resetPayMonth() {
    const month = this.payDialogMonth ?? this.monthKey;
    delete this.payMonths[month];
    this.#persistPay();
    this.payDialogMonth = null;
    this.#syncPay({ type: 'savePayMonth', month, pay: null }, `${monthName(month)}的設定已清除`);
  }

  /** 儲存常用類別。不合規則時回傳錯誤訊息。 */
  saveCatalog(draft: PayCatalog): string {
    const message = validateCatalog(draft);
    if (message) return message;
    const catalog = normalizeCatalog(JSON.parse(JSON.stringify(draft)))!;
    this.customCatalog = catalog;
    this.#persistPay();
    this.categoriesOpen = false;
    this.#syncPay({ type: 'savePayCatalog', catalog }, '常用類別已儲存');
    return '';
  }

  /** 薪資設定先存在本機，再排進佇列送到試算表 */
  #syncPay(op: Op, text: string) {
    if (this.payBackend === 'unsupported') {
      // 已經知道後端還沒更新，不用再送一個注定失敗的請求
      this.showToast(`${text}，但後端還沒更新，只存在這台裝置`, 'ok');
      return;
    }
    this.queue.push(op);
    this.#persistQueue();
    this.showToast(text, 'ok');
    void this.flushQueue();
  }

  // ---- 連線設定 ----

  openSettings() {
    this.settingsOpen = true;
  }

  closeSettings() {
    this.settingsOpen = false;
  }

  /** 某位使用者還有幾筆變更沒送出（切換使用者時，其他人的變更留在各自的佇列） */
  pendingCount(id: string) {
    return id === this.profileId ? this.queue.length : readQueue(keysFor(id)).length;
  }

  hasProfile(url: string, key: string) {
    return this.profiles.some((profile) => profile.url === url && profile.key === key);
  }

  #persistProfiles() {
    store.set(KEYS.profiles, { active: this.profileId, list: $state.snapshot(this.profiles) });
  }

  #updateProfile(id: string, changes: Partial<Profile>) {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return;
    this.profiles[index] = { ...this.profiles[index], ...changes };
    this.#persistProfiles();
  }

  /**
   * 新增（id 是 null）或修改一位使用者；不合規則時回傳錯誤訊息。
   * 新增後會切換過去；修改目前的使用者會重新載入。
   */
  saveProfile(id: string | null, name: string, url: string, key: string): string {
    name = name.trim();
    url = url.trim();
    key = key.trim();
    if (!name) return '請輸入名稱';
    if (name.length > MAX_PROFILE_NAME) return `名稱最多 ${MAX_PROFILE_NAME} 個字`;
    if (/^https:\/\/script\.google\.com\/.+\/dev$/.test(url)) return '要用結尾是 /exec 的部署網址，不是 /dev';
    if (!API_URL_PATTERN.test(url)) return '網址需要是 https://script.google.com/… 結尾為 /exec 的部署網址';
    if (!key) return '請輸入密鑰';

    if (id === null) {
      if (this.hasProfile(url, key)) return '這位使用者已經在這台裝置上了';
      this.#addProfile(name, url, key);
      return '';
    }

    const profile = this.profiles.find((item) => item.id === id);
    if (!profile) return '';
    const isActive = id === this.profileId;
    // 換成另一份試算表時，舊的快取與尚未送出的變更都不能帶過去，薪資設定也是各自的
    if (profile.url !== url) {
      clearProfileStorage(keysFor(id));
      if (isActive) {
        this.queue = [];
        this.months = {};
        this.payMonths = {};
        this.customCatalog = null;
        this.payBackend = 'unknown';
      }
    }
    const credentialsChanged = profile.url !== url || profile.key !== key;
    this.#updateProfile(id, { name, url, key, admin: credentialsChanged ? undefined : profile.admin });
    if (isActive && credentialsChanged) {
      this.accountBackend = 'unknown';
      this.syncError = null;
      this.loadError = null;
      void this.load();
    }
    if (isActive) this.settingsOpen = false;
    return '';
  }

  #addProfile(name: string, url: string, key: string, { activate = true } = {}) {
    // 第一位使用者用舊版的鍵名，和升級上來的裝置一致
    const id = this.profiles.length ? newProfileId() : MAIN_PROFILE;
    const keys = keysFor(id);
    if (id === MAIN_PROFILE) {
      // 第一次連線：沒連線前先設定好的薪資要留著，連上後送到試算表
      store.remove(keys.queue);
      store.removeWithPrefix(keys.monthPrefix);
    } else {
      clearProfileStorage(keys);
    }
    this.profiles.push({ id, name, url, key });
    this.#persistProfiles();
    if (activate) this.switchProfile(id);
    return id;
  }

  /** 換成另一位使用者：月曆、待同步變更、薪資設定都換成那位的 */
  switchProfile(id: string) {
    const profile = this.profiles.find((item) => item.id === id);
    if (!profile) return;
    const changed = id !== this.profileId;
    this.#epoch++;
    this.#requestId++;
    this.#flushing = null;
    this.syncing = false;
    this.profileId = id;
    this.#persistProfiles();

    const keys = this.#keys;
    const pay = normalizePayData(store.get(keys.pay));
    this.queue = readQueue(keys);
    this.months = {};
    this.payMonths = pay.months;
    this.customCatalog = pay.catalog;
    this.payBackend = 'unknown';
    this.accountBackend = 'unknown';
    this.loading = '';
    this.loadError = null;
    this.syncError = null;
    this.editing = null;
    this.payDialogMonth = null;
    this.categoriesOpen = false;
    this.settingsOpen = false;
    this.#lastRefresh = 0;
    if (changed && this.profiles.length > 1) this.showToast(`換成${profile.name}了`, 'ok');
    void this.load();
  }

  /** 從這台裝置移除一位使用者（試算表裡的資料不受影響）；至少要留一位 */
  removeProfile(id: string) {
    if (this.profiles.length < 2) return;
    const index = this.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return;
    clearProfileStorage(keysFor(id));
    if (id === MAIN_PROFILE) store.remove(KEYS.settings);
    this.profiles.splice(index, 1);
    this.#persistProfiles();
    if (id === this.profileId) this.switchProfile(this.profiles[0].id);
  }

  // ---- 管理員：在試算表建立使用者 ----

  /** 建立新的使用者（後端會開一份新的試算表），並加到這台裝置但不切換過去 */
  async createRemoteUser(name: string): Promise<{ user: RemoteUser } | { error: string }> {
    name = name.trim();
    if (!name) return { error: '請輸入名稱' };
    if (name.length > MAX_PROFILE_NAME) return { error: `名稱最多 ${MAX_PROFILE_NAME} 個字` };
    const settings = this.settings;
    if (!settings) return { error: '尚未設定連線' };
    try {
      const user = await callApi<RemoteUser>(settings, 'createUser', { name });
      this.addRemoteUser(user, settings.url);
      return { user };
    } catch (error) {
      return { error: asApiError(error).message };
    }
  }

  async listRemoteUsers(): Promise<{ users: RemoteUser[] } | { error: string }> {
    const settings = this.settings;
    if (!settings) return { error: '尚未設定連線' };
    try {
      return { users: await callApi<RemoteUser[]>(settings, 'listUsers', {}) };
    } catch (error) {
      return { error: asApiError(error).message };
    }
  }

  /** 把試算表裡的使用者加到這台裝置；同一個後端網址，換成那位的密鑰 */
  addRemoteUser(user: RemoteUser, url = this.settings?.url ?? '') {
    if (!url || this.hasProfile(url, user.key)) return;
    this.#addProfile(user.name, url, user.key, { activate: false });
  }

  // ---- 提示貼紙 ----

  showToast(text: string, tone: 'ok' | 'bad') {
    // 錯誤提示要等使用者按「知道了」，成功提示不能蓋掉它
    if (tone === 'ok' && this.toast?.tone === 'bad') return;
    clearTimeout(this.#toastTimer);
    this.toast = { id: ++this.#toastId, tone, text };
    if (tone === 'ok') this.#toastTimer = setTimeout(() => (this.toast = null), TOAST_MS);
  }

  dismissToast() {
    clearTimeout(this.#toastTimer);
    this.toast = null;
  }
}

export const app = new AppState();
