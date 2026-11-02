import { formatNumber, workedHours } from './calc';
import type {
  Entry, ItemMode, ItemSide, JobType, MonthPay, PayCatalog, PayCategory, PayData, PayItem, Rounding,
} from './types';

// ---- 規則常數（勞基法與本專案的簡化規則） ----

export const DAYS_PER_MONTH = 30;
export const DAY_HOURS = 8;
/** 月薪制：超過應上班時數的加班，一律按這個倍率計算（變形工時無法逐日分段） */
export const OVERTIME_RATE = 1.34;
export const MAX_MONEY = 10_000_000;
export const MAX_ITEMS = 20;
export const MAX_CATEGORIES = 40;
export const MAX_NAME_LENGTH = 20;

export const ROUNDINGS: { value: Rounding; label: string }[] = [
  { value: 'none', label: '不進位' },
  { value: 'round', label: '四捨五入' },
  { value: 'ceil', label: '無條件進位' },
];

interface Tier {
  hours: number;
  rate: number;
}

/** 休假（休息日、空班日）出勤，每天各自計算：前 2 小時、第 3–8 小時、第 9 小時起 */
const REST_DAY_TIERS: Tier[] = [
  { hours: 2, rate: 1.34 },
  { hours: 6, rate: 1.67 },
  { hours: Infinity, rate: 2.67 },
];

/** 國定假日、例假出勤超過 8 小時的部分，每天各自計算：前 2 小時、其後 */
const OVER_EIGHT_TIERS: Tier[] = [
  { hours: 2, rate: 1.34 },
  { hours: Infinity, rate: 1.67 },
];

/** 每年的基本工資（元）。每年第三季公告後，到這裡新增一列。 */
const MINIMUM_WAGES = [
  { from: '2026-01', hourly: 196, monthly: 29_500 },
  // 勞動部 2026/10 公告，2027/01/01 起實施（中央社 2026-10-02 報導）
  { from: '2027-01', hourly: 205, monthly: 30_900 },
];

/** 指定月份（yyyy-MM）適用的基本工資；比最早一筆更早的月份用最早一筆。 */
export function minimumWage(monthKey: string) {
  let found = MINIMUM_WAGES[0];
  for (const wage of MINIMUM_WAGES) if (wage.from <= monthKey) found = wage;
  return { hourly: found.hourly, monthly: found.monthly, year: Number(found.from.slice(0, 4)) };
}

// ---- 預設值 ----

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 內建的常用類別；使用者可以在「常用類別」裡改名、刪除、新增。id 固定，方便測試與比對。 */
export function defaultCatalog(): PayCatalog {
  const make = (id: string, name: string, side: ItemSide, mode: ItemMode, value: number): PayCategory => ({ id, name, side, mode, value });
  return {
    version: 1,
    categories: [
      make('allowance', '津貼', 'addition', 'amount', 0),
      make('bonus', '獎金', 'addition', 'amount', 0),
      make('extra', '加給', 'addition', 'amount', 0),
      make('labor', '勞保費', 'deduction', 'amount', 0),
      make('health', '健保費', 'deduction', 'amount', 0),
      make('welfare', '職工福利金', 'deduction', 'percent', 0.5),
      make('pension', '勞工自提退休金', 'deduction', 'percent', 0),
    ],
  };
}

export function blankMonthPay(): MonthPay {
  return { version: 1, jobType: 'fulltime', baseSalary: 0, hourlyWage: 0, rounding: 'round', payRounding: 'round', additions: [], deductions: [] };
}

/** 從常用類別加入：帶入預設的方式與金額，之後每月沿用 */
export function itemFromCategory(category: PayCategory): PayItem {
  return { id: newId(), name: category.name, mode: category.mode, value: category.value, regular: true };
}

/** 自訂項目（非經常性）：預設只限這個月 */
export function blankItem(): PayItem {
  return { id: newId(), name: '', mode: 'amount', value: 0, regular: false };
}

export const blankCategory = (side: ItemSide): PayCategory => ({ id: newId(), name: '', side, mode: 'amount', value: 0 });

// ---- 沿用前面月份的設定 ----

export type PaySource = 'own' | 'inherited';

export interface ResolvedPay {
  pay: MonthPay;
  source: PaySource;
  /** 設定來自哪個月；自己的設定就是這個月 */
  from: string;
}

/** 之後的月份只沿用「每月沿用」的項目，只限當月的項目不帶過去 */
function carryForward(pay: MonthPay): MonthPay {
  return {
    ...pay,
    additions: pay.additions.filter((item) => item.regular),
    deductions: pay.deductions.filter((item) => item.regular),
  };
}

/**
 * 某個月用哪一份設定：有自己的就用自己的，否則沿用比它早的最近一個月。
 * 比所有設定都早的月份回傳 null（不會倒回去套用之後才設定的內容，所以改設定不會動到更早的月份）。
 */
export function resolveMonthPay(months: Record<string, MonthPay>, monthKey: string): ResolvedPay | null {
  if (months[monthKey]) return { pay: months[monthKey], source: 'own', from: monthKey };
  const earlier = Object.keys(months).filter((key) => key < monthKey).sort().at(-1);
  if (!earlier) return null;
  return { pay: carryForward(months[earlier]), source: 'inherited', from: earlier };
}

/** 打開某個月的薪資設定時的草稿：自己的、沿用的、或參考之後最近的月份；都沒有就是空白 */
export function draftMonthPay(months: Record<string, MonthPay>, monthKey: string): MonthPay {
  const found = resolveMonthPay(months, monthKey);
  const later = Object.keys(months).filter((key) => key > monthKey).sort()[0];
  const source = found?.pay ?? (later ? carryForward(months[later]) : blankMonthPay());
  return structuredClone(source);
}

// ---- 檢查與修復 ----

const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MONEY;
const isPercent = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const moneyRange = `0 到 ${MAX_MONEY.toLocaleString('en-US')} 之間`;

function validateValue(item: { name: string; mode: ItemMode; value: number }, label: string): string {
  if (!item.name.trim()) return `${label}要填名稱`;
  if (item.name.trim().length > MAX_NAME_LENGTH) return `${label}的名稱最多 ${MAX_NAME_LENGTH} 個字`;
  if (item.mode === 'percent' ? !isPercent(item.value) : !isMoney(item.value)) {
    return item.mode === 'percent' ? `${label}的比例要在 0 到 100 之間` : `${label}的金額要在 ${moneyRange}`;
  }
  return '';
}

/** 儲存前檢查，回傳要給使用者看的錯誤訊息；沒問題回傳空字串。規則與 Code.gs 相同。 */
export function validateMonthPay(pay: MonthPay): string {
  if (pay.jobType === 'fulltime' && !(isMoney(pay.baseSalary) && pay.baseSalary > 0)) return '請填本薪';
  if (pay.jobType === 'parttime' && !(isMoney(pay.hourlyWage) && pay.hourlyWage > 0)) return '請填時薪';
  if (!ROUNDINGS.some((r) => r.value === pay.rounding)) return '請選擇時薪的進位方式';
  if (!ROUNDINGS.some((r) => r.value === pay.payRounding)) return '請選擇金額的進位方式';
  if (pay.additions.length > MAX_ITEMS) return `加項最多 ${MAX_ITEMS} 項`;
  if (pay.deductions.length > MAX_ITEMS) return `扣項最多 ${MAX_ITEMS} 項`;
  for (const [index, item] of pay.additions.entries()) {
    const message = validateValue(item, `第 ${index + 1} 個加項`);
    if (message) return message;
  }
  for (const [index, item] of pay.deductions.entries()) {
    const message = validateValue(item, `第 ${index + 1} 個扣項`);
    if (message) return message;
  }
  return '';
}

export function validateCatalog(catalog: PayCatalog): string {
  if (catalog.categories.length > MAX_CATEGORIES) return `常用類別最多 ${MAX_CATEGORIES} 個`;
  const count = { addition: 0, deduction: 0 };
  for (const category of catalog.categories) {
    count[category.side]++;
    const label = `第 ${count[category.side]} 個常用${category.side === 'addition' ? '加項' : '扣項'}`;
    const message = validateValue(category, label);
    if (message) return message;
  }
  return '';
}

const cleanMoney = (value: unknown) => (isMoney(value) ? Math.round(value * 100) / 100 : 0);
const cleanValue = (mode: ItemMode, value: unknown) => (mode === 'percent' ? (isPercent(value) ? Math.round(value * 100) / 100 : 0) : cleanMoney(value));
const cleanName = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, MAX_NAME_LENGTH) : '');
const cleanId = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : newId());
const cleanMode = (value: unknown): ItemMode => (value === 'percent' ? 'percent' : 'amount');
const asList = (value: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(value) ? value.slice(0, max) : []).map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}));

function cleanItems(value: unknown): PayItem[] {
  return asList(value, MAX_ITEMS).map((item) => {
    const mode = cleanMode(item.mode);
    return { id: cleanId(item.id), name: cleanName(item.name), mode, value: cleanValue(mode, item.value), regular: item.regular === true };
  });
}

/** 讀取本機快取或試算表的資料時使用：格式不對回傳 null，欄位有問題就修成安全的值。 */
export function normalizeMonthPay(raw: unknown): MonthPay | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.version !== 1 || (p.jobType !== 'fulltime' && p.jobType !== 'parttime')) return null;
  return {
    version: 1,
    jobType: p.jobType as JobType,
    baseSalary: cleanMoney(p.baseSalary),
    hourlyWage: cleanMoney(p.hourlyWage),
    rounding: ROUNDINGS.find((r) => r.value === p.rounding)?.value ?? 'round',
    payRounding: ROUNDINGS.find((r) => r.value === p.payRounding)?.value ?? 'round',
    additions: cleanItems(p.additions),
    deductions: cleanItems(p.deductions),
  };
}

export function normalizeCatalog(raw: unknown): PayCatalog | null {
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).version !== 1) return null;
  const categories = asList((raw as Record<string, unknown>).categories, MAX_CATEGORIES).map((item): PayCategory => {
    const mode = cleanMode(item.mode);
    return {
      id: cleanId(item.id),
      name: cleanName(item.name),
      side: item.side === 'deduction' ? 'deduction' : 'addition',
      mode,
      value: cleanValue(mode, item.value),
    };
  });
  return { version: 1, categories };
}

export function normalizePayData(raw: unknown): PayData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const months: Record<string, MonthPay> = {};
  if (r.months && typeof r.months === 'object') {
    for (const [key, value] of Object.entries(r.months)) {
      const pay = /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? normalizeMonthPay(value) : null;
      if (pay) months[key] = pay;
    }
  }
  return { catalog: normalizeCatalog(r.catalog), months };
}

// ---- 計算 ----

// 進位前先加（或減）一點點，避免 2305.4999999999995 這種浮點數誤差多算或少算 1 元
const EPSILON = 1e-7;
/** 四捨五入到整數元 */
export const toMoney = (value: number) => Math.round(value + EPSILON);

/**
 * 依設定處理一行金額：不進位（保留到小數第二位，也就是分）、四捨五入到整數、無條件進位到整數。
 * 合計用已經處理好的各行相加，畫面上看到的數字一定加得起來。
 */
export function roundAmount(value: number, mode: Rounding): number {
  // 加 0 是為了把 -0 變成 0，不然會顯示成「-0」
  if (mode === 'ceil') return Math.ceil(value - EPSILON) + 0;
  if (mode === 'round') return toMoney(value);
  return Math.round((value + 1e-9) * 100) / 100;
}

/** 用「分」相加再換回元，避免 0.1 + 0.2 = 0.30000000000000004 */
const sumAmounts = (lines: { amount: number }[]) => lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;

/** 時薪 = 本薪 ÷ 30 ÷ 8，再依設定進位 */
export function hourlyFromBase(baseSalary: number, rounding: Rounding): number {
  // 只做一次除法：結果剛好是整數或 .5 時，浮點數可以精確表示，不會有進位誤差
  const raw = baseSalary / (DAYS_PER_MONTH * DAY_HOURS);
  if (rounding === 'round') return Math.round(raw);
  if (rounding === 'ceil') return Math.ceil(raw);
  return raw;
}

/** fixed 為 true 時一律顯示兩位小數（金額設成「不進位」時，每一行的位數才會一樣） */
export function formatMoney(value: number, fixed = false): string {
  const digits = fixed ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
  return `${value < 0 ? '-' : ''}NT$ ${Math.abs(value).toLocaleString('en-US', digits)}`;
}

/**
 * 顯示算式裡的時薪或乘積：最多四位小數，後面還有數字（除不盡）就加「…」，
 * 讓人看得出計算用的是完整的數字，不是這四位。
 */
export function formatExact(value: number, digits = 4): string {
  const shown = Number(value.toFixed(digits));
  const text = shown.toLocaleString('en-US', { maximumFractionDigits: digits });
  return Math.abs(shown - value) > 1e-9 ? `${text}…` : text;
}

export const formatHourly = (value: number) => formatExact(value);

/** 設定視窗的範例：加班 hours 小時，時薪乘出來是多少，依設定進位後是多少 */
export function overtimePreview(settings: MonthPay, hours = 10) {
  const parttime = settings.jobType === 'parttime';
  const hourly = parttime ? settings.hourlyWage : hourlyFromBase(settings.baseSalary, settings.rounding);
  const rate = parttime ? 1 : OVERTIME_RATE;
  const raw = hours * hourly * rate;
  return { hours, hourly, rate, raw, amount: roundAmount(raw, settings.payRounding) };
}

export interface PayLine {
  key: string;
  label: string;
  detail?: string;
  amount: number;
}

export interface PayResult {
  jobType: JobType;
  hourly: number;
  /** 本月所有出勤時數 */
  totalHours: number;
  /** 計入 1.34 倍加班費的時數（平日超過應上班時數的部分） */
  overtimeHours: number;
  /** 還差幾小時才達到應上班時數；沒填應上班時數或已經達到時為 0 */
  shortfallHours: number;
  /** 正職沒填應上班時數，無法計算加班費 */
  requiredMissing: boolean;
  /** 加項：本薪或工資、加班費、假日加給，以及自己加的項目 */
  additions: PayLine[];
  deductions: PayLine[];
  additionTotal: number;
  deductionTotal: number;
  net: number;
}

/** 依時段倍率換算成「相當於幾小時的時薪」，例如休假出勤 3 小時 = 2×1.34 + 1×1.67 */
function tierUnits(hours: number, tiers: Tier[]): number {
  let remaining = hours;
  let units = 0;
  for (const tier of tiers) {
    const part = Math.min(remaining, tier.hours);
    if (part <= 0) break;
    units += part * tier.rate;
    remaining -= part;
  }
  return units;
}

/**
 * 計算一個月的薪資。
 *
 * 正職（月薪制、變形工時）：本薪已經包含應上班時數。
 * - 平日（沒有假別）與國定假日前 8 小時算進「平日時數」，超過應上班時數的部分 ×1.34；
 * - 國定假日出勤加發一日工資（8 小時），超過 8 小時的部分每天各自按 ×1.34、×1.67；
 * - 例假出勤同國定假日，但時數不算進平日時數；
 * - 休假（休息日）出勤每天各自按 ×1.34、×1.67、×2.67 分段，時數不算進平日時數。
 *
 * 工讀生：全部時數 × 時薪，不另外加成。
 */
export function computePay(settings: MonthPay, entries: Record<string, Entry>, requiredHours: number | null): PayResult {
  const parttime = settings.jobType === 'parttime';
  const hourly = parttime ? settings.hourlyWage : hourlyFromBase(settings.baseSalary, settings.rounding);
  // 時薪保留完整的數字（除不盡的不先砍成兩位小數）去乘，乘出來的每一行才依設定進位
  const money = (value: number) => roundAmount(value, settings.payRounding);
  const additions: PayLine[] = [];

  let totalHours = 0;
  let regularHours = 0; // 平日與國定假日前 8 小時
  let holidayDays = 0;
  let leaveDays = 0;
  let overEightHours = 0;
  let overEightUnits = 0;
  let restDays = 0;
  let restHours = 0;
  let restUnits = 0;

  for (const entry of Object.values(entries)) {
    const hours = workedHours(entry);
    if (hours <= 0) continue;
    totalHours += hours;
    if (parttime) continue;

    if (entry.dayType === '休假') {
      restDays++;
      restHours += hours;
      restUnits += tierUnits(hours, REST_DAY_TIERS);
    } else if (entry.dayType === '國定假日' || entry.dayType === '例假') {
      if (entry.dayType === '國定假日') {
        holidayDays++;
        regularHours += Math.min(hours, DAY_HOURS);
      } else {
        leaveDays++;
      }
      const extra = Math.max(hours - DAY_HOURS, 0);
      overEightHours += extra;
      overEightUnits += tierUnits(extra, OVER_EIGHT_TIERS);
    } else {
      regularHours += hours;
    }
  }

  let wage = 0;
  let overtimeHours = 0;
  let shortfallHours = 0;
  const requiredMissing = !parttime && requiredHours === null;

  if (parttime) {
    wage = money(totalHours * hourly);
    additions.push({ key: 'wage', label: '工資', detail: `${formatNumber(totalHours)} 小時 × 時薪 ${formatHourly(hourly)}`, amount: wage });
  } else {
    wage = money(settings.baseSalary);
    additions.push({ key: 'base', label: '本薪', amount: wage });

    if (requiredHours !== null) {
      overtimeHours = Math.max(regularHours - requiredHours, 0);
      shortfallHours = Math.max(requiredHours - regularHours, 0);
    }
    if (overtimeHours > 0) {
      additions.push({
        key: 'overtime',
        label: '加班費',
        detail: `${formatNumber(overtimeHours)} 小時 × 時薪 ${formatHourly(hourly)} × ${OVERTIME_RATE}`,
        amount: money(overtimeHours * hourly * OVERTIME_RATE),
      });
    }
    if (holidayDays > 0) {
      additions.push({
        key: 'holiday',
        label: '國定假日出勤加發',
        detail: `${holidayDays} 天 × ${DAY_HOURS} 小時 × 時薪 ${formatHourly(hourly)}`,
        amount: money(holidayDays * DAY_HOURS * hourly),
      });
    }
    if (leaveDays > 0) {
      additions.push({
        key: 'leave',
        label: '例假出勤加發',
        detail: `${leaveDays} 天 × ${DAY_HOURS} 小時 × 時薪 ${formatHourly(hourly)}`,
        amount: money(leaveDays * DAY_HOURS * hourly),
      });
    }
    if (overEightHours > 0) {
      additions.push({
        key: 'over-eight',
        label: '假日超過 8 小時',
        detail: `共 ${formatNumber(overEightHours)} 小時（每天前 2 小時 ×1.34，其後 ×1.67）`,
        amount: money(overEightUnits * hourly),
      });
    }
    if (restDays > 0) {
      additions.push({
        key: 'rest',
        label: '休假日出勤',
        detail: `${restDays} 天共 ${formatNumber(restHours)} 小時（每天 ×1.34／×1.67／×2.67 分段）`,
        amount: money(restUnits * hourly),
      });
    }
  }

  // 比例的基準：正職是本薪，工讀生是當月工資
  const percentBase = parttime ? wage : settings.baseSalary;
  const toLine = (prefix: string) => (item: PayItem): PayLine => ({
    key: `${prefix}-${item.id}`,
    label: item.name,
    detail: item.mode === 'percent' ? `${formatNumber(item.value)}%` : undefined,
    amount: money(item.mode === 'percent' ? (percentBase * item.value) / 100 : item.value),
  });
  additions.push(...settings.additions.map(toLine('addition')));
  const deductions = settings.deductions.map(toLine('deduction'));

  const additionTotal = sumAmounts(additions);
  const deductionTotal = sumAmounts(deductions);

  return {
    jobType: settings.jobType,
    hourly,
    totalHours,
    overtimeHours,
    shortfallHours,
    requiredMissing,
    additions,
    deductions,
    additionTotal,
    deductionTotal,
    net: sumAmounts([{ amount: additionTotal }, { amount: -deductionTotal }]),
  };
}
