export type DayType = '' | '例假' | '休假' | '國定假日';

/** 一天的紀錄；欄位與 Apps Script 回傳的格式相同，時間以小數小時表示（9.5 = 09:30）。 */
export interface Entry {
  date: string;
  plannedStart: number | null;
  plannedEnd: number | null;
  actualStart: number | null;
  actualEnd: number | null;
  dayType: DayType;
}

export interface MonthData {
  entries: Record<string, Entry>;
  requiredHours: number | null;
}

export interface Settings {
  url: string;
  key: string;
}

export type JobType = 'fulltime' | 'parttime';
/** 時薪由本薪換算時的進位方式：不進位、四捨五入到整數、無條件進位到整數 */
export type Rounding = 'none' | 'round' | 'ceil';
export type ItemMode = 'amount' | 'percent';
export type ItemSide = 'addition' | 'deduction';

/** 一個月裡的一筆加項或扣項；percent 是本薪（工讀生是當月工資）的百分比 */
export interface PayItem {
  id: string;
  name: string;
  mode: ItemMode;
  value: number;
  /** true：之後沒有自己設定的月份會沿用；false：只限這個月 */
  regular: boolean;
}

/**
 * 某個月的薪資設定。每個月各自一份：改了本薪只影響這個月和之後沿用它的月份，
 * 更早的月份不受影響。
 */
export interface MonthPay {
  version: 1;
  jobType: JobType;
  /** 正職的月薪本薪 */
  baseSalary: number;
  /** 工讀生的時薪 */
  hourlyWage: number;
  rounding: Rounding;
  /** 卡片上每一行金額（時薪乘出來的加班費、假日加給、工資，以及比例的項目）的進位方式 */
  payRounding: Rounding;
  additions: PayItem[];
  deductions: PayItem[];
}

/** 常用類別：每月薪資設定裡可以一鍵加入，並帶入預設的方式與金額 */
export interface PayCategory {
  id: string;
  name: string;
  side: ItemSide;
  mode: ItemMode;
  value: number;
}

export interface PayCatalog {
  version: 1;
  categories: PayCategory[];
}

/** 試算表裡所有的薪資設定 */
export interface PayData {
  /** 還沒自訂過常用類別時是 null，使用內建的預設 */
  catalog: PayCatalog | null;
  /** key 是 yyyy-MM */
  months: Record<string, MonthPay>;
}

/** 尚未送到試算表的變更；每一筆都是「設成某個值」，重送也不會出錯。 */
export type Op =
  | { type: 'saveEntry'; entry: Entry }
  | { type: 'deleteEntry'; date: string }
  | { type: 'saveRequired'; month: string; value: number | null }
  | { type: 'savePayCatalog'; catalog: PayCatalog }
  /** pay 是 null 代表清除這個月自己的設定，改回沿用前面的月份 */
  | { type: 'savePayMonth'; month: string; pay: MonthPay | null };
