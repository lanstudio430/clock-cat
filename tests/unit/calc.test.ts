import { describe, expect, it } from 'vitest';
import {
  buildWeeks, catMessage, dayLabel, effectiveTime, formatTime, goalMet, monthKeyOf, monthTotal, progressPercent,
  shiftMonthKey, toIso, validateEntry, workedHours,
} from '../../web/src/lib/calc';
import { applyOp, describeOp, fromServer, opMonth } from '../../web/src/lib/ops';
import type { Entry } from '../../web/src/lib/types';

const entry = (over: Partial<Entry> = {}): Entry => ({
  date: '2026-11-02', plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, dayType: '', ...over,
});

describe('日期', () => {
  it('月份鍵與跨年位移', () => {
    expect(monthKeyOf(2026, 10)).toBe('2026-11');
    expect(monthKeyOf(2026, 12)).toBe('2027-01');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2027-01', -1)).toBe('2026-12');
    expect(toIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('週一開始，補滿整週', () => {
    const weeks = buildWeeks(2026, 10, {});
    expect(weeks).toHaveLength(6);
    expect(toIso(weeks[0].days[0])).toBe('2026-10-26');
    expect(toIso(weeks[0].days[6])).toBe('2026-11-01');
    expect(toIso(weeks[5].days[6])).toBe('2026-12-06');
    expect(buildWeeks(2027, 1, {})).toHaveLength(4);
  });

  it('週合計只算當月，其他月份的日期不計入', () => {
    const entries = Object.fromEntries([
      entry({ date: '2026-10-26', actualStart: 8, actualEnd: 12 }),
      entry({ date: '2026-11-01', actualStart: 8, actualEnd: 10 }),
      entry({ date: '2026-11-30', actualStart: 9, actualEnd: 18 }),
      entry({ date: '2026-12-02', actualStart: 9, actualEnd: 10 }),
    ].map((e) => [e.date, e]));
    const weeks = buildWeeks(2026, 10, entries);
    expect(weeks.map((w) => w.total)).toEqual([2, 0, 0, 0, 0, 9]);
    expect(monthTotal(weeks)).toBe(11);
  });
});

describe('顯示與計算規則', () => {
  it('有實際用實際，沒有用原定', () => {
    expect(effectiveTime(entry({ plannedStart: 9, plannedEnd: 18, actualStart: 9.25, actualEnd: 21.75 }))).toEqual({ label: '實際', start: 9.25, end: 21.75 });
    expect(effectiveTime(entry({ plannedStart: 9, plannedEnd: 18 }))).toEqual({ label: '原定', start: 9, end: 18 });
    expect(effectiveTime(entry({ dayType: '例假' }))).toBeNull();
    expect(effectiveTime(undefined)).toBeNull();
  });

  it('沒填的欄位是 undefined 也不會變成 NaN', () => {
    const partial = { date: '2026-11-04', plannedStart: 9, plannedEnd: 18, dayType: '' } as unknown as Entry;
    expect(effectiveTime(partial)).toEqual({ label: '原定', start: 9, end: 18 });
    expect(workedHours(partial)).toBe(9);
  });

  it('時數是下班減上班，不扣休息', () => {
    expect(workedHours(entry({ plannedStart: 9, plannedEnd: 21.5 }))).toBe(12.5);
    expect(workedHours(entry())).toBe(0);
  });

  it('整點補零，有分鐘用小數', () => {
    expect([formatTime(9), formatTime(21.5), formatTime(6), formatTime(21.75)]).toEqual(['09', '21.5', '06', '21.75']);
  });

  it('日期格子的說明文字', () => {
    const date = new Date(2026, 10, 3);
    expect(dayLabel(date, entry({ date: '2026-11-03', actualStart: 9.25, actualEnd: 21.75, dayType: '國定假日' }))).toBe('11月3日，實際 9.25 至 21.75，國定假日');
    expect(dayLabel(date, entry({ plannedStart: 9, plannedEnd: 18 }))).toBe('11月3日，原定 09 至 18');
    expect(dayLabel(date, undefined)).toBe('11月3日');
  });
});

describe('驗證（與 Code.gs 相同）', () => {
  it.each([
    [entry(), '請選擇上下班時間或假別'],
    [entry({ plannedStart: 18, plannedEnd: 9 }), '原定下班時間需要晚於上班時間'],
    [entry({ actualStart: 9, actualEnd: 9 }), '實際下班時間需要晚於上班時間'],
    [entry({ actualStart: 9 }), '實際上班與下班時間需要同時選擇'],
    [entry({ plannedEnd: 18 }), '原定上班與下班時間需要同時選擇'],
    [entry({ dayType: '例假' }), ''],
    [entry({ plannedStart: 9, plannedEnd: 18 }), ''],
  ])('%j → %s', (value, message) => {
    expect(validateEntry(value)).toBe(message);
  });
});

describe('本月卡', () => {
  it.each([
    [85.25, null, '填上時數，我幫你算加班'],
    [0, 176, '點日期開始記錄吧'],
    [85.25, 176, '還差 90.75 小時，加油喵'],
    [176, 176, '剛好達標，辛苦了喵！'],
    [178.5, 176, '達標啦，多了 2.5 小時，辛苦了喵！'],
  ])('已排 %s、應上班 %s → %s', (total, required, message) => {
    expect(catMessage(total, required)).toBe(message);
  });

  it('達標與百分比', () => {
    expect(goalMet(176, 176)).toBe(true);
    expect(goalMet(175.75, 176)).toBe(false);
    expect(goalMet(10, null)).toBe(false);
    expect(progressPercent(88, 176)).toBe(50);
    expect(progressPercent(10, null)).toBeNull();
    expect(progressPercent(0, 0)).toBe(100);
  });
});

describe('變更佇列', () => {
  it('套用、還原與說明', () => {
    const data = fromServer({ entries: [entry({ dayType: '例假' })], requiredHours: null });
    expect(Object.keys(data.entries)).toEqual(['2026-11-02']);
    const save = { type: 'saveEntry', entry: entry({ date: '2026-11-03', actualStart: 9, actualEnd: 18 }) } as const;
    applyOp(data, save);
    applyOp(data, save);
    applyOp(data, { type: 'deleteEntry', date: '2026-11-02' });
    applyOp(data, { type: 'saveRequired', month: '2026-11', value: 176 });
    expect(Object.keys(data.entries)).toEqual(['2026-11-03']);
    expect(data.requiredHours).toBe(176);
    expect([opMonth(save), describeOp(save), describeOp({ type: 'saveRequired', month: '2026-11', value: 1 })]).toEqual(['2026-11', '11月3日', '應上班時數']);
  });

  it('伺服器沒回傳應上班時數時視為未填', () => {
    expect(fromServer({ entries: [], requiredHours: undefined as unknown as null }).requiredHours).toBeNull();
  });
});
