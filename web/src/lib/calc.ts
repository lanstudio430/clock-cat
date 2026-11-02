import type { Entry } from './types';

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
export const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
export const MINUTES: [number, string][] = [[0, '0'], [0.25, '.25'], [0.5, '.5'], [0.75, '.75']];
export const DAY_TYPES = ['例假', '休假', '國定假日'] as const;

export const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKeyOf(year: number, month: number): string {
  return toIso(new Date(year, month, 1)).slice(0, 7);
}

export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKeyOf(year, month - 1 + delta);
}

export function weekdayOf(date: Date): string {
  return WEEKDAYS[(date.getDay() + 6) % 7];
}

export interface Week {
  days: Date[];
  total: number;
}

/** 從第一週的星期一排到最後一週的星期日；週合計只算當月的日期。 */
export function buildWeeks(year: number, month: number, entries: Record<string, Entry>): Week[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + dayCount) / 7) * 7;
  const days = Array.from({ length: cellCount }, (_, i) => new Date(year, month, 1 - offset + i));
  const weeks: Week[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const total = week.reduce((sum, date) => (date.getMonth() === month ? sum + workedHours(entries[toIso(date)]) : sum), 0);
    weeks.push({ days: week, total });
  }
  return weeks;
}

export function monthTotal(weeks: Week[]): number {
  return weeks.reduce((sum, week) => sum + week.total, 0);
}

export interface TimeRange {
  label: '實際' | '原定';
  start: number;
  end: number;
}

// 有填實際時間就用實際，否則用原定；日曆顯示與週合計都以此為準。
// 用 Number.isFinite 判斷：沒填的時間可能是 null 或 undefined。
export function effectiveTime(entry: Entry | undefined | null): TimeRange | null {
  if (entry && Number.isFinite(entry.actualStart) && Number.isFinite(entry.actualEnd)) {
    return { label: '實際', start: entry.actualStart as number, end: entry.actualEnd as number };
  }
  if (entry && Number.isFinite(entry.plannedStart) && Number.isFinite(entry.plannedEnd)) {
    return { label: '原定', start: entry.plannedStart as number, end: entry.plannedEnd as number };
  }
  return null;
}

export function workedHours(entry: Entry | undefined | null): number {
  const time = effectiveTime(entry);
  return time ? Math.max(time.end - time.start, 0) : 0;
}

export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// 整點補零（09），有分鐘時維持小數（9.5）
export function formatTime(value: number): string {
  return Number.isInteger(value) ? pad(value) : formatNumber(value);
}

// 與 Apps Script 端的規則一致，讓錯誤在儲存前就能提示
export function validateEntry(entry: Entry): string {
  const ranges: [string, number | null, number | null][] = [
    ['原定', entry.plannedStart, entry.plannedEnd],
    ['實際', entry.actualStart, entry.actualEnd],
  ];
  for (const [label, start, end] of ranges) {
    if ((start === null) !== (end === null)) return `${label}上班與下班時間需要同時選擇`;
    if (start !== null && end !== null && end <= start) return `${label}下班時間需要晚於上班時間`;
  }
  if (entry.plannedStart === null && entry.actualStart === null && !entry.dayType) {
    return '請選擇上下班時間或假別';
  }
  return '';
}

const hundredths = (value: number) => Math.round(value * 100);

/** 本月卡上貓咪說的話，依設計規格由上往下判斷。 */
export function catMessage(total: number, required: number | null): string {
  if (required === null) return '填上時數，我幫你算加班';
  if (hundredths(total) === 0) return '點日期開始記錄吧';
  if (hundredths(total) < hundredths(required)) return `還差 ${formatNumber(required - total)} 小時，加油喵`;
  if (hundredths(total) === hundredths(required)) return '剛好達標，辛苦了喵！';
  return `達標啦，多了 ${formatNumber(total - required)} 小時，辛苦了喵！`;
}

export function goalMet(total: number, required: number | null): boolean {
  return required !== null && hundredths(total) >= hundredths(required);
}

/** 圓環的百分比；沒填應上班時數時回傳 null。 */
export function progressPercent(total: number, required: number | null): number | null {
  if (required === null) return null;
  if (required <= 0) return 100;
  return (total / required) * 100;
}

/** 日期格子的完整說明，給螢幕閱讀器使用，例如「11月3日，實際 9.25 至 21.75，國定假日」。 */
export function dayLabel(date: Date, entry: Entry | undefined): string {
  const parts = [`${date.getMonth() + 1}月${date.getDate()}日`];
  const time = effectiveTime(entry);
  if (time) parts.push(`${time.label} ${formatTime(time.start)} 至 ${formatTime(time.end)}`);
  if (entry?.dayType) parts.push(entry.dayType);
  return parts.join('，');
}
