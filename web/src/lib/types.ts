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

/** 尚未送到試算表的變更；每一筆都是「設成某個值」，重送也不會出錯。 */
export type Op =
  | { type: 'saveEntry'; entry: Entry }
  | { type: 'deleteEntry'; date: string }
  | { type: 'saveRequired'; month: string; value: number | null };
