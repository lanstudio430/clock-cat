import type { Entry, MonthData, Op } from './types';

export interface ServerMonth {
  entries: Entry[];
  requiredHours: number | null;
}

export function fromServer(month: ServerMonth): MonthData {
  return {
    entries: Object.fromEntries(month.entries.map((entry) => [entry.date, entry])),
    requiredHours: Number.isFinite(month.requiredHours) ? month.requiredHours : null,
  };
}

/** 變更屬於哪個月份；薪資設定不屬於任何月份，回傳 null。 */
export function opMonth(op: Op): string | null {
  if (op.type === 'saveEntry') return op.entry.date.slice(0, 7);
  if (op.type === 'deleteEntry') return op.date.slice(0, 7);
  if (op.type === 'saveRequired') return op.month;
  return null;
}

/** 把月份相關的變更套用到月份資料上；薪資設定不是月份資料，不處理。 */
export function applyOp(data: MonthData, op: Op): void {
  if (op.type === 'saveEntry') data.entries[op.entry.date] = { ...op.entry };
  else if (op.type === 'deleteEntry') delete data.entries[op.date];
  else if (op.type === 'saveRequired') data.requiredHours = op.value;
}

/** 用在錯誤訊息裡，例如「11月3日」或「應上班時數」。 */
export function describeOp(op: Op): string {
  if (op.type === 'saveRequired') return '應上班時數';
  if (op.type === 'savePayCatalog') return '常用類別';
  if (op.type === 'savePayMonth') return `${Number(op.month.slice(5))} 月薪資設定`;
  const [, month, day] = (op.type === 'saveEntry' ? op.entry.date : op.date).split('-').map(Number);
  return `${month}月${day}日`;
}
