'use strict';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_TYPE_STYLES = {
  '例假': { cell: 'bg-orange-50', badge: 'bg-orange-200 text-orange-900' },
  '休假': { cell: 'bg-orange-50/60', badge: 'bg-orange-100 text-orange-800' },
  '國定假日': { cell: 'bg-red-50', badge: 'bg-red-100 text-red-800' }
};
const TIME_FIELDS = ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const MINUTES = [['0', '0'], ['0.25', '.25'], ['0.5', '.5'], ['0.75', '.75']];
const YEAR_RANGE = 5;
const MAX_REQUIRED_HOURS = 744;

const REQUEST_TIMEOUT_MS = 20000;
const STALE_AFTER_MS = 30000;
const API_URL_PATTERN = /^https:\/\/script\.google\.com\/.+\/exec$/;
const STORAGE_KEYS = { settings: 'clockcat:settings', queue: 'clockcat:queue', monthPrefix: 'clockcat:month:' };

// ---------------------------------------------------------------------------
// 本機儲存：瀏覽器可能封鎖或清空，所有讀寫都要容錯
// ---------------------------------------------------------------------------

const store = {
  get(key) {
    try {
      const text = localStorage.getItem(key);
      return text === null ? null : JSON.parse(text);
    } catch (error) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // 空間不足或被封鎖時，只是失去離線快取
    }
  },
  removeWithPrefix(prefix) {
    try {
      Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      // 同上
    }
  }
};

// ---------------------------------------------------------------------------
// 狀態
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);
const now = new Date();
const savedQueue = store.get(STORAGE_KEYS.queue);
const state = {
  year: now.getFullYear(),
  month: now.getMonth(),
  settings: store.get(STORAGE_KEYS.settings),
  queue: Array.isArray(savedQueue) ? savedQueue : [], // 還沒送到試算表的變更
  loading: '', // '' | 'loading' | 'updating'
  loadError: null,
  syncError: null,
  alert: '',
  requestId: 0,
  syncedOps: 0,
  lastRefresh: 0,
  editingDate: null
};
const monthCache = new Map(); // 月份 → { entries: {日期: 紀錄}, requiredHours }

function isConfigured() {
  return Boolean(state.settings && state.settings.url && state.settings.key);
}

// ---------------------------------------------------------------------------
// 日期與月份
// ---------------------------------------------------------------------------

function toIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey() {
  return toIso(new Date(state.year, state.month, 1)).slice(0, 7);
}

function shiftMonthKey(key, delta) {
  const [year, month] = key.split('-').map(Number);
  return toIso(new Date(year, month - 1 + delta, 1)).slice(0, 7);
}

// 回傳該月行事曆要顯示的所有日期，從第一週的星期一排到最後一週的星期日
function gridDays() {
  const offset = (new Date(state.year, state.month, 1).getDay() + 6) % 7;
  const dayCount = new Date(state.year, state.month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + dayCount) / 7) * 7;
  return Array.from({ length: cellCount }, (_, i) =>
    new Date(state.year, state.month, 1 - offset + i));
}

// ---------------------------------------------------------------------------
// 月份資料快取（同時存在記憶體與 localStorage，離線時也能顯示）
// ---------------------------------------------------------------------------

function getMonthData(key) {
  if (!monthCache.has(key)) {
    const saved = store.get(STORAGE_KEYS.monthPrefix + key);
    monthCache.set(key, saved && saved.entries ? saved : null);
  }
  return monthCache.get(key);
}

function putMonthData(key, data) {
  monthCache.set(key, data);
  store.set(STORAGE_KEYS.monthPrefix + key, data);
}

const currentData = () => getMonthData(monthKey());
const isReady = () => Boolean(currentData());
const entries = () => (currentData() ? currentData().entries : {});

function fromServer(month) {
  return {
    entries: Object.fromEntries(month.entries.map((entry) => [entry.date, entry])),
    requiredHours: Number.isFinite(month.requiredHours) ? month.requiredHours : null
  };
}

// ---------------------------------------------------------------------------
// 變更：先改畫面與本機快取，再排進佇列慢慢送到試算表。
// 每個變更都是「把某天/某月設成某個值」，重複套用結果相同，所以可以安全重送。
// ---------------------------------------------------------------------------

function opMonth(op) {
  if (op.type === 'saveEntry') return op.entry.date.slice(0, 7);
  if (op.type === 'deleteEntry') return op.date.slice(0, 7);
  return op.month;
}

function applyOp(data, op) {
  if (op.type === 'saveEntry') data.entries[op.entry.date] = { ...op.entry };
  else if (op.type === 'deleteEntry') delete data.entries[op.date];
  else data.requiredHours = op.value;
}

function describeOp(op) {
  if (op.type === 'saveRequired') return '應上班時數';
  const [, month, day] = (op.type === 'saveEntry' ? op.entry.date : op.date).split('-').map(Number);
  return `${month}月${day}日`;
}

function persistQueue() {
  store.set(STORAGE_KEYS.queue, state.queue);
}

function commit(op) {
  const key = opMonth(op);
  const data = getMonthData(key);
  if (data) {
    applyOp(data, op);
    putMonthData(key, data);
  }
  state.queue.push(op);
  persistQueue();
  state.alert = '';
  renderAll();
  flushQueue();
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// kind: 'offline' 稍後重試、'config' 需要使用者處理設定、'rejected' 伺服器拒絕這筆變更
class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const KIND_BY_CODE = {
  rejected: 'rejected',
  busy: 'offline',
  unauthorized: 'config',
  not_configured: 'config',
  bad_request: 'config'
};

async function callApi(action, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(state.settings.url, {
      method: 'POST',
      // text/plain 是「簡單請求」，不會觸發 CORS 預檢，Apps Script 才收得到
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: state.settings.key, action, ...params }),
      credentials: 'omit',
      signal: controller.signal
    });
  } catch (error) {
    throw new ApiError('offline', navigator.onLine === false
      ? '目前沒有網路'
      : '無法連線到 Apps Script，請確認網址正確，且部署的存取權限為「任何人」');
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError('config', '無法讀取伺服器回應，請確認網址正確，且部署的存取權限為「任何人」');
  }
  if (!payload.ok) throw new ApiError(KIND_BY_CODE[payload.code] || 'config', payload.error);
  return payload.data;
}

function sendOp(op) {
  if (op.type === 'saveEntry') return callApi('saveEntry', { entry: op.entry });
  if (op.type === 'deleteEntry') return callApi('deleteEntry', { date: op.date });
  return callApi('saveRequiredHours', { month: op.month, value: op.value });
}

let flushing = null;

// 依序送出佇列；同一時間只會有一個在跑。回傳的 Promise 不會 reject，失敗記在 state.syncError。
function flushQueue() {
  if (!flushing) {
    flushing = runQueue().finally(() => {
      flushing = null;
      renderStatus();
    });
  }
  return flushing;
}

async function runQueue() {
  while (state.queue.length && isConfigured()) {
    const op = state.queue[0];
    try {
      await sendOp(op);
    } catch (error) {
      if (error.kind !== 'rejected') {
        state.syncError = error; // 變更留在佇列，之後再試
        return;
      }
      // 伺服器明確拒絕：丟掉這筆，並用試算表的內容還原畫面
      state.queue.shift();
      persistQueue();
      state.alert = `${describeOp(op)}未儲存：${error.message}`;
      load({ quiet: true });
      continue;
    }
    state.queue.shift();
    persistQueue();
    state.syncedOps++;
    renderStatus();
  }
  state.syncError = null;
}

// 先送出待處理的變更，再抓前後各一個月，之後切換月份就不用等
async function refreshMonths(centerKey) {
  await flushQueue();

  const keys = [shiftMonthKey(centerKey, -1), centerKey, shiftMonthKey(centerKey, 1)];
  let months;
  for (let attempt = 0; attempt < 3; attempt++) {
    const syncedBefore = state.syncedOps;
    months = await callApi('getMonths', { months: keys });
    if (syncedBefore === state.syncedOps) break; // 抓取期間有變更完成，結果可能是舊的，再抓一次
  }

  for (const key of keys) {
    if (!months[key]) continue;
    const data = fromServer(months[key]);
    state.queue.filter((op) => opMonth(op) === key).forEach((op) => applyOp(data, op));
    putMonthData(key, data);
  }
  state.lastRefresh = Date.now();
}

async function load({ quiet = false } = {}) {
  const requestId = ++state.requestId;
  const key = monthKey();

  state.loadError = null;
  state.loading = isReady() ? (quiet ? '' : 'updating') : 'loading';
  renderAll({ force: true });
  if (!isConfigured()) {
    state.loading = '';
    renderStatus();
    return;
  }

  try {
    await refreshMonths(key);
  } catch (error) {
    // 只採用最新一次請求的結果，避免快速切換月份時被舊的覆蓋
    if (requestId !== state.requestId) return;
    state.loading = '';
    state.loadError = error;
    renderAll();
    return;
  }
  if (requestId !== state.requestId) return;
  state.loading = '';
  renderAll();
}

// ---------------------------------------------------------------------------
// 計算與格式
// ---------------------------------------------------------------------------

// 有填實際時間就用實際，否則用原定；日曆顯示與週合計都以此為準
// 用 Number.isFinite 判斷：沒填的時間可能是 null 或 undefined
function effectiveTime(entry) {
  if (entry && Number.isFinite(entry.actualStart) && Number.isFinite(entry.actualEnd)) {
    return { label: '實際', start: entry.actualStart, end: entry.actualEnd };
  }
  if (entry && Number.isFinite(entry.plannedStart) && Number.isFinite(entry.plannedEnd)) {
    return { label: '原定', start: entry.plannedStart, end: entry.plannedEnd };
  }
  return null;
}

function workedHours(entry) {
  const time = effectiveTime(entry);
  return time ? Math.max(time.end - time.start, 0) : 0;
}

function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}

// 整點補零（09），有分鐘時維持小數（9.5）
function formatTime(value) {
  return Number.isInteger(value) ? String(value).padStart(2, '0') : formatNumber(value);
}

// 與 Apps Script 端的規則一致，讓錯誤能在儲存前就提示
function validateEntry(entry) {
  const ranges = [['原定', entry.plannedStart, entry.plannedEnd], ['實際', entry.actualStart, entry.actualEnd]];
  for (const [label, start, end] of ranges) {
    if ((start === null) !== (end === null)) return `${label}上班與下班時間需要同時選擇`;
    if (start !== null && end <= start) return `${label}下班時間需要晚於上班時間`;
  }
  if (entry.plannedStart === null && entry.actualStart === null && !entry.dayType) {
    return '請選擇上下班時間或假別';
  }
  return '';
}

// ---------------------------------------------------------------------------
// 畫面
// ---------------------------------------------------------------------------

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeStack(time) {
  const stack = make('span', 'flex flex-col text-[13px] font-bold leading-tight tabular-nums text-red-700 sm:text-base');
  stack.append(make('span', '', formatTime(time.start)), make('span', '', formatTime(time.end)));
  return stack;
}

function renderDay(date, todayIso) {
  const iso = toIso(date);
  const entry = entries()[iso];
  const style = entry && DAY_TYPE_STYLES[entry.dayType];
  const label = [`${date.getMonth() + 1}月${date.getDate()}日`];

  const button = make('button',
    'flex min-h-[5.5rem] min-w-0 flex-col items-start gap-1 border-b border-r border-dashed border-rule p-1 text-left ' +
    'hover:enabled:bg-rule/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ' +
    `disabled:cursor-default sm:min-h-[6.5rem] sm:p-2 ${style ? style.cell : ''}`);
  button.type = 'button';
  button.disabled = !isReady();

  const number = make('span',
    iso === todayIso
      ? 'flex h-6 w-6 items-center justify-center rounded-[50%_45%_55%_48%] border-2 border-ink text-sm font-bold'
      : 'flex h-6 items-center text-sm text-pencil',
    date.getDate());
  const content = make('span', 'flex min-w-0 max-w-full flex-col items-start gap-1');
  const time = effectiveTime(entry);

  if (time) {
    content.append(timeStack(time));
    label.push(`${time.label} ${formatTime(time.start)} 至 ${formatTime(time.end)}`);
  }
  if (entry && entry.dayType) {
    content.append(make('span',
      `max-w-full rounded px-1 py-px text-[11px] leading-snug sm:px-1.5 sm:text-xs ${style ? style.badge : 'bg-rule'}`,
      entry.dayType));
    label.push(entry.dayType);
  }

  button.append(number, content);
  button.setAttribute('aria-label', label.join('，'));
  button.addEventListener('click', () => openDialog(iso, date));
  return button;
}

function renderCalendar() {
  const calendar = el('calendar');
  const days = gridDays();
  const todayIso = toIso(new Date());
  const ready = isReady();
  let grandTotal = 0;

  calendar.classList.toggle('opacity-50', !ready);
  calendar.replaceChildren(
    ...WEEKDAYS.map((name) => make('div', 'border-b border-rule py-2 text-center text-sm text-pencil', name)),
    make('div', 'border-b border-rule py-2 text-center text-sm font-bold', '合計')
  );

  // 只有當月的日期會顯示與計算，所以週合計與加總都不含其他月份
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const hours = week.reduce((sum, date) => (date.getMonth() === state.month
      ? sum + workedHours(entries()[toIso(date)])
      : sum), 0);
    grandTotal += hours;
    calendar.append(...week.map((date) => (date.getMonth() === state.month
      ? renderDay(date, todayIso)
      : make('div', 'border-b border-r border-dashed border-rule'))));
    calendar.append(make('div',
      'flex items-center justify-center border-b border-dashed border-rule text-sm font-bold tabular-nums sm:text-base',
      ready ? `${formatNumber(hours)}h` : '–'));
  }

  const requiredHours = ready ? currentData().requiredHours : null;
  calendar.append(...renderSummaryRow('週合計加總', ready ? `${formatNumber(grandTotal)}h` : '–'));
  if (Number.isFinite(requiredHours)) {
    calendar.append(...renderSummaryRow('加班時數', `${formatNumber(grandTotal - requiredHours)}h`));
  }
}

function renderSummaryRow(label, value) {
  return [
    make('div', 'col-span-6 flex items-center justify-end px-3 py-2 text-sm text-pencil sm:col-span-7 sm:text-base', label),
    make('div', 'col-span-2 flex items-center justify-end whitespace-nowrap py-2 pr-2 text-sm font-bold tabular-nums sm:col-span-1 sm:justify-center sm:pr-0 sm:text-base', value)
  ];
}

function renderSelectors() {
  const options = [];
  for (let year = state.year - YEAR_RANGE; year <= state.year + YEAR_RANGE; year++) {
    options.push(new Option(`${year} 年`, year, false, year === state.year));
  }
  el('year').replaceChildren(...options);
  el('month').value = state.month;
}

// 正在輸入時不要覆蓋使用者打到一半的內容，除非是切換月份或要還原
function renderRequired(force) {
  const input = el('required');
  const requiredHours = isReady() ? currentData().requiredHours : null;
  input.disabled = !isReady();
  if (force || document.activeElement !== input) {
    input.value = Number.isFinite(requiredHours) ? requiredHours : '';
  }
}

function statusMessage() {
  const pending = state.queue.length;
  const error = state.syncError || state.loadError;

  if (state.alert) {
    return { text: state.alert, isError: true, action: ['知道了', () => { state.alert = ''; renderStatus(); }] };
  }
  if (!isConfigured()) {
    return { text: '尚未設定連線', isError: true, action: ['設定', openSettings] };
  }
  if (error && error.kind === 'config') {
    return { text: error.message, isError: true, action: ['設定', openSettings] };
  }
  if (error) {
    const text = isReady()
      ? `${pending ? `${pending} 筆變更尚未同步` : '顯示的是上次的資料'}：${error.message}`
      : `載入失敗：${error.message}`;
    return { text, isError: true, action: ['重試', () => load()] };
  }
  if (state.loading) {
    return { text: state.loading === 'loading' ? '載入中…' : '更新中…', icon: 'fa-solid fa-circle-notch fa-spin' };
  }
  if (pending) {
    return { text: '同步中…', icon: 'fa-solid fa-circle-notch fa-spin' };
  }
  return { text: '' };
}

function renderStatus() {
  const { text, icon, isError, action } = statusMessage();
  const status = el('status');
  status.replaceChildren();
  status.classList.toggle('text-red-700', Boolean(isError));
  if (icon) status.append(make('i', `${icon} mr-1`));
  status.append(text);
  if (action) {
    const button = make('button', 'ml-2 underline underline-offset-4', action[0]);
    button.type = 'button';
    button.addEventListener('click', action[1]);
    status.append(button);
  }
}

function renderAll({ force = false } = {}) {
  renderRequired(force);
  renderCalendar();
  renderStatus();
}

// ---------------------------------------------------------------------------
// 導覽
// ---------------------------------------------------------------------------

function goTo(year, month) {
  const target = new Date(year, month, 1);
  state.year = target.getFullYear();
  state.month = target.getMonth();
  renderSelectors();
  load();
}

function saveRequired() {
  const input = el('required');
  const reject = (message) => {
    renderRequired(true);
    state.alert = `應上班時數未儲存：${message}`;
    renderStatus();
  };

  if (!isReady()) return;
  if (input.validity.badInput) return reject('請輸入數字');

  const isBlank = input.value.trim() === '';
  const value = isBlank ? null : Number(input.value);
  if (!isBlank && !(value >= 0 && value <= MAX_REQUIRED_HOURS)) {
    return reject(`需介於 0 到 ${MAX_REQUIRED_HOURS} 之間`);
  }
  commit({ type: 'saveRequired', month: monthKey(), value });
}

// ---------------------------------------------------------------------------
// 編輯某一天
// ---------------------------------------------------------------------------

function buildTimeField(container) {
  const field = container.dataset.time;
  const label = container.dataset.label;
  const selectClass = 'h-10 w-full min-w-0 cursor-pointer rounded-none border-b border-ink/40 bg-transparent tabular-nums ' +
    'outline-none hover:bg-rule/40 focus:border-b-2 focus:border-ink';

  const hour = make('select', selectClass);
  hour.id = `${field}Hour`;
  hour.setAttribute('aria-label', `${label}（時）`);
  hour.append(new Option('--', ''), ...HOURS.map((h) => new Option(String(h).padStart(2, '0'), h)));

  const minute = make('select', selectClass);
  minute.id = `${field}Minute`;
  minute.setAttribute('aria-label', `${label}（分）`);
  minute.append(...MINUTES.map(([value, text]) => new Option(text, value)));

  const row = make('div', 'mt-1 grid grid-cols-[3fr_2fr] gap-2');
  row.append(hour, minute);
  container.append(make('span', 'text-sm text-pencil', label.slice(2)), row);
}

function readTime(field) {
  const hour = el(`${field}Hour`).value;
  return hour === '' ? null : Number(hour) + Number(el(`${field}Minute`).value);
}

function writeTime(field, value) {
  const isBlank = value === null || value === undefined;
  el(`${field}Hour`).value = isBlank ? '' : Math.floor(value);
  el(`${field}Minute`).value = isBlank ? '0' : value - Math.floor(value);
}

function openDialog(iso, date) {
  const entry = entries()[iso];
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];

  state.editingDate = iso;
  el('dialog-title').textContent =
    `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日（${weekday}）`;
  TIME_FIELDS.forEach((field) => writeTime(field, entry && entry[field]));
  // 逐一設定：RadioNodeList.value 指定空字串時不會選取「無」
  for (const radio of el('form').elements.dayType) {
    radio.checked = radio.value === (entry ? entry.dayType : '');
  }
  el('delete').hidden = !entry;
  el('form-error').textContent = '';
  el('dialog').showModal();
}

el('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = { date: state.editingDate, dayType: el('form').elements.dayType.value };
  TIME_FIELDS.forEach((field) => { entry[field] = readTime(field); });

  const message = validateEntry(entry);
  if (message) {
    el('form-error').textContent = message;
    return;
  }
  commit({ type: 'saveEntry', entry });
  el('dialog').close();
});

el('delete').addEventListener('click', () => {
  commit({ type: 'deleteEntry', date: state.editingDate });
  el('dialog').close();
});

el('cancel').addEventListener('click', () => el('dialog').close());

// ---------------------------------------------------------------------------
// 連線設定
// ---------------------------------------------------------------------------

function openSettings() {
  el('settings-url').value = state.settings ? state.settings.url : '';
  el('settings-key').value = state.settings ? state.settings.key : '';
  el('settings-error').textContent = '';
  el('settings').showModal();
}

function resetLocalData() {
  state.queue = [];
  persistQueue();
  monthCache.clear();
  store.removeWithPrefix(STORAGE_KEYS.monthPrefix);
  state.alert = '';
  state.syncError = null;
}

el('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = el('settings-url').value.trim();
  const key = el('settings-key').value.trim();

  if (!API_URL_PATTERN.test(url)) {
    el('settings-error').textContent = '網址需要是 https://script.google.com/… 結尾為 /exec 的部署網址';
    return;
  }
  if (!key) {
    el('settings-error').textContent = '請輸入密鑰';
    return;
  }

  // 換成另一份試算表時，舊的快取與尚未送出的變更都不能帶過去
  if (!state.settings || state.settings.url !== url) resetLocalData();
  state.settings = { url, key };
  state.syncError = null;
  store.set(STORAGE_KEYS.settings, state.settings);
  el('settings').close();
  load();
});

el('settings-cancel').addEventListener('click', () => el('settings').close());
el('open-settings').addEventListener('click', openSettings);

// ---------------------------------------------------------------------------
// 事件與啟動
// ---------------------------------------------------------------------------

el('prev').addEventListener('click', () => goTo(state.year, state.month - 1));
el('next').addEventListener('click', () => goTo(state.year, state.month + 1));
el('today').addEventListener('click', () => {
  const today = new Date();
  goTo(today.getFullYear(), today.getMonth());
});
el('year').addEventListener('change', (event) => goTo(Number(event.target.value), state.month));
el('month').addEventListener('change', (event) => goTo(state.year, Number(event.target.value)));
el('required').addEventListener('change', saveRequired);

// 恢復連線或回到 App 時重新同步
window.addEventListener('online', () => load({ quiet: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastRefresh > STALE_AFTER_MS) {
    load({ quiet: true });
  }
});

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.querySelectorAll('[data-time]').forEach(buildTimeField);
el('month').replaceChildren(
  ...Array.from({ length: 12 }, (_, i) => new Option(`${i + 1} 月`, i))
);
renderSelectors();
if (!isConfigured()) openSettings();
load();
