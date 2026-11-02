import { ApiError, callApi } from './api';
import { buildWeeks, formatNumber, goalMet, monthKeyOf, monthTotal, shiftMonthKey, validateEntry, workedHours } from './calc';
import { applyOp, describeOp, fromServer, opMonth, type ServerMonth } from './ops';
import { KEYS, store } from './storage';
import type { Entry, MonthData, Op, Settings } from './types';

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
  }

  // ---- 變更與同步 ----

  #commit(op: Op) {
    const key = opMonth(op);
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

    // 換成另一份試算表時，舊的快取與尚未送出的變更都不能帶過去
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
