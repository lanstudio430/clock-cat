import { ApiError, callApi } from './api';
import { buildWeeks, formatNumber, goalMet, monthKeyOf, monthTotal, shiftMonthKey, validateEntry, workedHours } from './calc';
import { applyOp, describeOp, fromServer, opMonth, type ServerMonth } from './ops';
import {
  computePay, defaultCatalog, normalizeCatalog, normalizeMonthPay, normalizePayData, resolveMonthPay, validateCatalog,
  validateMonthPay,
} from './pay';
import { KEYS, store } from './storage';
import type { Entry, MonthData, MonthPay, Op, PayCatalog, Settings } from './types';

export const API_URL_PATTERN = /^https:\/\/script\.google\.com\/.+\/exec$/;
export const MAX_REQUIRED_HOURS = 744;
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

function readSettings(): Settings | null {
  const saved = store.get<Settings>(KEYS.settings);
  return saved && typeof saved.url === 'string' && typeof saved.key === 'string' ? saved : null;
}

function readQueue(): Op[] {
  const saved = store.get<Op[]>(KEYS.queue);
  return Array.isArray(saved) ? saved : [];
}

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
  settings = $state<Settings | null>(readSettings());
  queue = $state<Op[]>(readQueue());
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
  payMonths = $state<Record<string, MonthPay>>(normalizePayData(store.get(KEYS.pay)).months);
  /** 使用者自訂過的常用類別；還沒自訂過是 null，使用內建的預設 */
  customCatalog = $state<PayCatalog | null>(normalizePayData(store.get(KEYS.pay)).catalog);
  /** 後端還沒更新（不認得薪資設定的動作）時，薪資設定只存在這台裝置 */
  payBackend = $state<'unknown' | 'ok' | 'unsupported'>('unknown');
  toast = $state<Toast | null>(null);
  celebrate = $state(0);

  #requestId = 0;
  #syncedOps = 0;
  #lastRefresh = 0;
  #flushing: Promise<void> | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  #toastId = 0;

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
    const saved = store.get<MonthData>(KEYS.monthPrefix + key);
    this.months[key] = saved && saved.entries ? saved : null;
  }

  #putMonth(key: string, data: MonthData) {
    this.months[key] = data;
    store.set(KEYS.monthPrefix + key, $state.snapshot(data));
  }

  #persistQueue() {
    store.set(KEYS.queue, $state.snapshot(this.queue));
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
    await this.flushQueue();

    const keys = [shiftMonthKey(centerKey, -1), centerKey, shiftMonthKey(centerKey, 1)];
    let months: Record<string, ServerMonth> = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      const syncedBefore = this.#syncedOps;
      months = await callApi<Record<string, ServerMonth>>(this.settings!, 'getMonths', { months: keys });
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
    await this.#refreshPay();
  }

  /** 以試算表的薪資設定為準；失敗不影響月曆，下次再試。 */
  async #refreshPay() {
    if (this.payBackend === 'unsupported' || this.queue.some(isPayOp)) return;
    const syncedBefore = this.#syncedOps;
    try {
      const raw = await callApi<unknown>(this.settings!, 'getPayData', {});
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
      if (error instanceof ApiError && error.code === 'bad_request') this.payBackend = 'unsupported';
    }
  }

  #persistPay() {
    store.set(KEYS.pay, { catalog: $state.snapshot(this.customCatalog), months: $state.snapshot(this.payMonths) });
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
      this.#flushing = this.#runQueue().finally(() => {
        this.#flushing = null;
        this.syncing = false;
      });
    }
    return this.#flushing;
  }

  async #runQueue() {
    while (this.queue.length && this.isConfigured) {
      const op = $state.snapshot(this.queue[0]) as Op;
      try {
        await this.#send(op);
      } catch (error) {
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

  /** 檢查並儲存網址與密鑰；不合規則時回傳錯誤訊息。 */
  saveSettings(url: string, key: string): string {
    url = url.trim();
    key = key.trim();
    if (/^https:\/\/script\.google\.com\/.+\/dev$/.test(url)) return '要用結尾是 /exec 的部署網址，不是 /dev';
    if (!API_URL_PATTERN.test(url)) return '網址需要是 https://script.google.com/… 結尾為 /exec 的部署網址';
    if (!key) return '請輸入密鑰';

    // 換成另一份試算表時，舊的快取與尚未送出的變更都不能帶過去，薪資設定也是各自的
    if (this.settings && this.settings.url !== url) {
      this.payMonths = {};
      this.customCatalog = null;
      this.payBackend = 'unknown';
      store.remove(KEYS.pay);
    }
    if (!this.settings || this.settings.url !== url) {
      this.queue = [];
      this.#persistQueue();
      this.months = {};
      store.removeWithPrefix(KEYS.monthPrefix);
    }
    this.settings = { url, key };
    store.set(KEYS.settings, { url, key });
    this.syncError = null;
    this.loadError = null;
    this.settingsOpen = false;
    void this.load();
    return '';
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
