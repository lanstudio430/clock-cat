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

export function opMonth(op: Op): string {
  if (op.type === 'saveEntry') return op.entry.date.slice(0, 7);
  if (op.type === 'deleteEntry') return op.date.slice(0, 7);
  return op.month;
}

export function applyOp(data: MonthData, op: Op): void {
  if (op.type === 'saveEntry') data.entries[op.entry.date] = { ...op.entry };
  else if (op.type === 'deleteEntry') delete data.entries[op.date];
  else data.requiredHours = op.value;
}

/** 用在錯誤訊息裡，例如「11月3日」或「應上班時數」。 */
export function describeOp(op: Op): string {
  if (op.type === 'saveRequired') return '應上班時數';
  const [, month, day] = (op.type === 'saveEntry' ? op.entry.date : op.date).split('-').map(Number);
  return `${month}月${day}日`;
}
