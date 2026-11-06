import { describe, expect, it } from 'vitest';
import {
  blankMonthPay, computePay, defaultCatalog, draftMonthPay, formatExact, formatMoney, hourlyFromBase, itemFromCategory,
  minimumWage, normalizeCatalog, normalizeMonthPay, normalizePayData, overtimePreview, resolveMonthPay, roundAmount, toMoney,
  validateCatalog, validateMonthPay,
} from '../../web/src/lib/pay';
import type { DayType, Entry, MonthPay, PayItem } from '../../web/src/lib/types';

let itemCount = 0;
/** id 只允許英數字，所以用流水號，不能直接拿中文名稱 */
const item = (name: string, value: number, over: Partial<PayItem> = {}): PayItem => ({
  id: `i${++itemCount}`, name, mode: 'amount', value, regular: true, ...over,
});

/** 預設本薪 36,000（時薪 150，方便手算），沒有任何加項扣項 */
const pay = (over: Partial<MonthPay> = {}): MonthPay => ({ ...blankMonthPay(), baseSalary: 36000, ...over });

let counter = 0;
/** 一天的紀錄：hours 為 [上班, 下班]；planned 為 true 時只填原定 */
const day = (hours: [number, number] | null, dayType: DayType = '', planned = false): Entry => {
  counter++;
  return {
    date: `2026-11-${String((counter % 28) + 1).padStart(2, '0')}`,
    plannedStart: planned && hours ? hours[0] : null,
    plannedEnd: planned && hours ? hours[1] : null,
    actualStart: !planned && hours ? hours[0] : null,
    actualEnd: !planned && hours ? hours[1] : null,
    dayType,
  };
};
const month = (...entries: Entry[]) =>
  Object.fromEntries(entries.map((e, i) => { const date = `2026-11-${String(i + 1).padStart(2, '0')}`; return [date, { ...e, date }]; }));
const line = (result: ReturnType<typeof computePay>, key: string) => result.additions.find((l) => l.key === key);

describe('時薪 = 本薪 ÷ 30 ÷ 8', () => {
  it.each([
    // 本薪, 不進位, 四捨五入, 無條件進位
    [36000, 150, 150, 150], // 剛好整除，無條件進位不能多進 1
    [30000, 125, 125, 125],
    [33000, 137.5, 138, 138], // 剛好 .5：四捨五入進位
    [29500, 29500 / 240, 123, 123], // 122.9166…
    [40000, 40000 / 240, 167, 167], // 166.666…
    [28000, 28000 / 240, 117, 117], // 116.666…
    [30100, 30100 / 240, 125, 126], // 125.4166…：四捨五入向下、無條件進位向上
  ])('本薪 %d', (base, none, round, ceil) => {
    expect(hourlyFromBase(base, 'none')).toBeCloseTo(none, 10);
    expect(hourlyFromBase(base, 'round')).toBe(round);
    expect(hourlyFromBase(base, 'ceil')).toBe(ceil);
  });

  it('不進位時保留小數，並用完整精度算加班費', () => {
    // 29,500 → 時薪 122.9166…；加班 10 小時 ×1.34 = 1647.083… → 1647
    const result = computePay(pay({ baseSalary: 29500, rounding: 'none' }), month(day([8, 18])), 0);
    expect(result.hourly).toBeCloseTo(122.9167, 4);
    expect(line(result, 'overtime')!.amount).toBe(1647);
  });

  it('四捨五入、無條件進位的時薪會影響加班費', () => {
    const entries = month(day([8, 18])); // 10 小時
    expect(line(computePay(pay({ baseSalary: 30100, rounding: 'round' }), entries, 0), 'overtime')!.amount).toBe(toMoney(10 * 125 * 1.34)); // 1675
    expect(line(computePay(pay({ baseSalary: 30100, rounding: 'ceil' }), entries, 0), 'overtime')!.amount).toBe(toMoney(10 * 126 * 1.34)); // 1688.4 → 1688
    expect(line(computePay(pay({ baseSalary: 30100, rounding: 'none' }), entries, 0), 'overtime')!.amount).toBe(toMoney(10 * (30100 / 240) * 1.34)); // 1680.58 → 1681
  });
});

describe('正職：平日加班（超過應上班時數的部分 ×1.34）', () => {
  it('超過才算，未超過不扣錢也不算加班', () => {
    // 時薪 150；應上班 10 小時，做了 12 小時 → 加班 2 小時 = 2 × 150 × 1.34 = 402
    const over = computePay(pay(), month(day([9, 15]), day([9, 15])), 10);
    expect(over.overtimeHours).toBe(2);
    expect(line(over, 'overtime')!.amount).toBe(402);
    expect(over.net).toBe(36000 + 402);

    const under = computePay(pay(), month(day([9, 15]), day([9, 13])), 10); // 10 小時，剛好
    expect(under.overtimeHours).toBe(0);
    expect(line(under, 'overtime')).toBeUndefined();
    const short = computePay(pay(), month(day([9, 13])), 10); // 4 小時，還差 6
    expect(short.shortfallHours).toBe(6);
    expect(short.net).toBe(36000);
  });

  it('用實際時間，沒填實際才用原定', () => {
    const entries = month(
      { ...day([9, 15]), plannedStart: 9, plannedEnd: 12 }, // 實際 6 小時蓋過原定 3 小時
      day([9, 13], '', true), // 只有原定 4 小時
    );
    expect(computePay(pay(), entries, 0).totalHours).toBe(10);
  });

  it('沒填應上班時數時無法算加班費', () => {
    const result = computePay(pay(), month(day([8, 18])), null);
    expect(result.requiredMissing).toBe(true);
    expect(line(result, 'overtime')).toBeUndefined();
    expect(result.net).toBe(36000);
  });

  it('應上班時數是 0 也是有效值，所有平日時數都是加班', () => {
    const result = computePay(pay(), month(day([9, 13])), 0);
    expect(line(result, 'overtime')!.amount).toBe(toMoney(4 * 150 * 1.34)); // 804
  });
});

describe('正職：國定假日', () => {
  it('8 小時內：時數算進平日時數，另加發一日工資（8 小時 × 時薪）', () => {
    const result = computePay(pay(), month(day([9, 15], '國定假日')), 0); // 6 小時
    expect(line(result, 'holiday')!.amount).toBe(8 * 150); // 1200，不論實際做幾小時
    expect(result.overtimeHours).toBe(6); // 平日時數 6 小時、應上班 0
    expect(line(result, 'over-eight')).toBeUndefined();
  });

  it('超過 8 小時：整天時數都算進平日時數，超出應上班時數的部分併入加班費 ×1.34', () => {
    // 做 13 小時、應上班 8 小時：多出 5 小時算加班費 = 5 × 150 × 1.34 = 1005
    const result = computePay(pay(), month(day([7, 20], '國定假日')), 8);
    expect(result.overtimeHours).toBe(5);
    expect(line(result, 'overtime')!.amount).toBe(1005);
    expect(line(result, 'holiday')!.amount).toBe(1200);
    expect(line(result, 'over-eight')).toBeUndefined();
  });

  it('超過 8 小時但整個月還沒做滿應上班時數，就沒有加班費', () => {
    const result = computePay(pay(), month(day([7, 20], '國定假日')), 20);
    expect(result.overtimeHours).toBe(0);
    expect(result.shortfallHours).toBe(7);
    expect(line(result, 'overtime')).toBeUndefined();
    expect(line(result, 'over-eight')).toBeUndefined();
  });

  it('每天各自計算，一天不滿 8 小時就沒有超時', () => {
    const result = computePay(pay(), month(day([9, 14], '國定假日'), day([9, 14], '國定假日')), 10);
    expect(line(result, 'holiday')!.amount).toBe(2 * 1200);
    expect(line(result, 'over-eight')).toBeUndefined();
  });

  it('只標了國定假日、沒有出勤，不加發', () => {
    expect(line(computePay(pay(), month(day(null, '國定假日')), 0), 'holiday')).toBeUndefined();
  });
});

describe('正職：休假（休息日、空班日）', () => {
  // 時薪 150；每天前 2 小時 ×1.34、第 3–8 小時 ×1.67、第 9 小時起 ×2.67
  it.each([
    [1, 1 * 1.34],
    [2, 2 * 1.34], // 2.68
    [3, 2 * 1.34 + 1 * 1.67], // 4.35
    [4, 2 * 1.34 + 2 * 1.67], // 6.02
    [8, 2 * 1.34 + 6 * 1.67], // 12.70
    [9, 2 * 1.34 + 6 * 1.67 + 2.67], // 15.37
    [12, 2 * 1.34 + 6 * 1.67 + 4 * 2.67], // 23.38
  ])('出勤 %d 小時', (hours, units) => {
    const result = computePay(pay(), month(day([7, 7 + hours], '休假')), 0);
    expect(line(result, 'rest')!.amount).toBe(toMoney(units * 150));
    expect(result.overtimeHours).toBe(0); // 休假的時數不算進平日加班
  });

  it('每天各自分段，不是整個月合起來分段', () => {
    // 兩天各 2 小時：每天都是前 2 小時 ×1.34 → 4 × 1.34 = 5.36；若合併成 4 小時會是 6.02
    const result = computePay(pay(), month(day([9, 11], '休假'), day([9, 11], '休假')), 0);
    expect(line(result, 'rest')!.amount).toBe(toMoney(5.36 * 150)); // 804
  });

  it('0.25 小時為單位', () => {
    const result = computePay(pay(), month(day([9, 11.75], '休假')), 0); // 2.75 小時
    expect(line(result, 'rest')!.amount).toBe(toMoney((2 * 1.34 + 0.75 * 1.67) * 150));
  });

  it('只標了休假、沒有出勤，不算錢', () => {
    expect(line(computePay(pay(), month(day(null, '休假')), 0), 'rest')).toBeUndefined();
  });
});

describe('正職：例假', () => {
  it('出勤加發一日工資，時數不算進平日時數，超過 8 小時前 2 小時 ×1.34、其後 ×1.67', () => {
    const result = computePay(pay(), month(day([7, 19], '例假')), 0); // 12 小時
    expect(line(result, 'leave')!.amount).toBe(1200);
    expect(result.overtimeHours).toBe(0);
    // 多出 4 小時 = 2×1.34 + 2×1.67 = 6.02
    expect(line(result, 'over-eight')!.amount).toBe(toMoney(6.02 * 150)); // 903
  });
});

describe('工讀生：時薪 × 工時', () => {
  const parttime = (over: Partial<MonthPay> = {}) => pay({ jobType: 'parttime', hourlyWage: 196, baseSalary: 0, ...over });

  it('所有出勤時數都用時薪計算，假別不加成', () => {
    const entries = month(day([9, 18]), day([9, 13], '休假'), day([9, 12], '國定假日'), day([9, 11], '例假'));
    const result = computePay(parttime(), entries, null);
    expect(result.totalHours).toBe(9 + 4 + 3 + 2);
    expect(result.additions.map((l) => l.key)).toEqual(['wage']);
    expect(result.additions[0].amount).toBe(18 * 196);
    expect(result.requiredMissing).toBe(false);
  });

  it('沒有出勤就是 0', () => {
    expect(computePay(parttime(), {}, null).net).toBe(0);
  });

  it('時薪有小數時，工資四捨五入到整數元', () => {
    expect(computePay(parttime({ hourlyWage: 183.5 }), month(day([9, 10.25])), null).additions[0].amount).toBe(toMoney(1.25 * 183.5)); // 229.375 → 229
  });
});

describe('加項、扣項與實領', () => {
  it('加項（自己加的）接在本薪與加班費後面；各項扣除後得到實領', () => {
    const settings = pay({
      additions: [item('伙食津貼', 2400), item('全勤獎金', 1000), item('主管加給', 3000)],
      deductions: [
        item('勞保費', 900),
        item('健保費', 600),
        item('職工福利金', 0.5, { mode: 'percent' }), // 36000 × 0.5% = 180
        item('勞工自提退休金', 6, { mode: 'percent' }), // 36000 × 6% = 2160
      ],
    });
    const result = computePay(settings, month(day([9, 15]), day([9, 15])), 10); // 加班 2 小時 402
    expect(result.additions.map((l) => [l.label, l.amount])).toEqual([
      ['本薪', 36000], ['加班費', 402], ['伙食津貼', 2400], ['全勤獎金', 1000], ['主管加給', 3000],
    ]);
    expect(result.additionTotal).toBe(36000 + 402 + 2400 + 1000 + 3000);
    expect(result.deductions.map((l) => [l.label, l.amount, l.detail])).toEqual([
      ['勞保費', 900, undefined], ['健保費', 600, undefined], ['職工福利金', 180, '0.5%'], ['勞工自提退休金', 2160, '6%'],
    ]);
    expect(result.deductionTotal).toBe(3840);
    expect(result.net).toBe(42802 - 3840);
  });

  it('加項也可以用比例（本薪的百分比）', () => {
    const result = computePay(pay({ additions: [item('績效獎金', 10, { mode: 'percent' })] }), {}, 0);
    expect(result.additions.at(-1)).toMatchObject({ label: '績效獎金', amount: 3600, detail: '10%' });
  });

  it('工讀生的比例項目以當月工資為基準', () => {
    const settings = pay({ jobType: 'parttime', hourlyWage: 200, deductions: [item('福利金', 1, { mode: 'percent' })] });
    const result = computePay(settings, month(day([9, 19])), null); // 10 小時 = 2000
    expect(result.deductions[0].amount).toBe(20);
    expect(result.net).toBe(1980);
  });

  it('每一行先進位到整數元再相加，合計一定等於各行相加', () => {
    const settings = pay({ baseSalary: 29500, rounding: 'none', deductions: [item('自提', 3.3, { mode: 'percent' })] });
    const result = computePay(settings, month(day([9, 18]), day([9, 14], '休假')), 0);
    expect(result.additionTotal).toBe(result.additions.reduce((s, l) => s + l.amount, 0));
    expect(result.net).toBe(result.additionTotal - result.deductions.reduce((s, l) => s + l.amount, 0));
    for (const l of [...result.additions, ...result.deductions]) expect(Number.isInteger(l.amount)).toBe(true);
  });

  it('浮點數誤差不會少算 1 元', () => {
    expect(toMoney(2305.4999999999995)).toBe(2306);
    expect(toMoney(0.49)).toBe(0);
    expect(toMoney(1234.5)).toBe(1235);
  });
});

describe('每個月各自的設定：沿用前面的月份、不影響更早的月份', () => {
  const nov = pay({
    baseSalary: 36000,
    additions: [item('伙食津貼', 2400), item('補發差額', 500, { regular: false })],
    deductions: [item('勞保費', 900), item('團保', 100, { regular: false })],
  });
  const dec = pay({ baseSalary: 40000, additions: [item('伙食津貼', 2400)] });

  it('有自己的設定就用自己的', () => {
    expect(resolveMonthPay({ '2026-11': nov }, '2026-11')).toMatchObject({ source: 'own', from: '2026-11' });
  });

  it('沒有自己的設定時，沿用比它早的最近一個月，只帶過去「每月沿用」的項目', () => {
    const result = resolveMonthPay({ '2026-11': nov }, '2026-12')!;
    expect(result.source).toBe('inherited');
    expect(result.from).toBe('2026-11');
    expect(result.pay.baseSalary).toBe(36000);
    expect(result.pay.additions.map((i) => i.name)).toEqual(['伙食津貼']); // 「補發差額」只限當月，沒有帶過來
    expect(result.pay.deductions.map((i) => i.name)).toEqual(['勞保費']);
  });

  it('沿用的是原始設定的副本，原本那個月不會被改到', () => {
    const months = { '2026-11': structuredClone(nov) };
    resolveMonthPay(months, '2026-12');
    expect(months['2026-11'].additions).toHaveLength(2);
  });

  it('改了本薪，更早的月份不受影響；更晚、沒有自己設定的月份會跟著沿用', () => {
    const months = { '2026-11': nov, '2026-12': dec };
    // 12 月調薪到 40,000：11 月仍然是 36,000
    expect(resolveMonthPay(months, '2026-11')!.pay.baseSalary).toBe(36000);
    expect(resolveMonthPay(months, '2026-12')!.pay.baseSalary).toBe(40000);
    // 1 月沒有自己的設定，沿用 12 月（最近的）而不是 11 月
    expect(resolveMonthPay(months, '2027-01')).toMatchObject({ source: 'inherited', from: '2026-12' });
    expect(resolveMonthPay(months, '2027-01')!.pay.baseSalary).toBe(40000);
    // 在 1 月自己設定之後，2 月沿用 1 月，12 月不受影響
    const withJan = { ...months, '2027-01': pay({ baseSalary: 42000 }) };
    expect(resolveMonthPay(withJan, '2027-02')!.pay.baseSalary).toBe(42000);
    expect(resolveMonthPay(withJan, '2026-12')!.pay.baseSalary).toBe(40000);
  });

  it('比所有設定都早的月份沒有設定，不會倒回去套用之後才設定的內容', () => {
    expect(resolveMonthPay({ '2026-11': nov }, '2026-10')).toBeNull();
    expect(resolveMonthPay({}, '2026-11')).toBeNull();
  });

  it('沿用跨年也正確', () => {
    expect(resolveMonthPay({ '2026-12': dec }, '2027-01')!.from).toBe('2026-12');
    expect(resolveMonthPay({ '2027-01': dec }, '2026-12')).toBeNull();
  });

  it('打開設定時的草稿：自己的、沿用的、參考之後的月份、空白', () => {
    expect(draftMonthPay({ '2026-11': nov }, '2026-11').additions).toHaveLength(2); // 自己的：完整內容
    expect(draftMonthPay({ '2026-11': nov }, '2026-12').additions.map((i) => i.name)).toEqual(['伙食津貼']); // 沿用
    const before = draftMonthPay({ '2026-11': nov }, '2026-10'); // 比所有設定都早：參考最近的之後月份
    expect(before.baseSalary).toBe(36000);
    expect(before.deductions.map((i) => i.name)).toEqual(['勞保費']);
    expect(draftMonthPay({}, '2026-11')).toEqual(blankMonthPay());
  });

  it('草稿是副本，改草稿不會動到已存的設定', () => {
    const months = { '2026-11': nov };
    const draft = draftMonthPay(months, '2026-11');
    draft.baseSalary = 1;
    draft.additions[0].value = 1;
    expect(months['2026-11'].baseSalary).toBe(36000);
    expect(months['2026-11'].additions[0].value).toBe(2400);
  });

  it('各個月用各自的設定算薪水', () => {
    const entries = month(day([9, 19])); // 10 小時
    const months = { '2026-11': nov, '2026-12': dec };
    const a = computePay(resolveMonthPay(months, '2026-11')!.pay, entries, 0);
    const b = computePay(resolveMonthPay(months, '2026-12')!.pay, entries, 0);
    expect(line(a, 'base')!.amount).toBe(36000);
    expect(line(b, 'base')!.amount).toBe(40000);
    expect(line(a, 'overtime')!.amount).toBe(toMoney(10 * 150 * 1.34)); // 時薪 150
    expect(line(b, 'overtime')!.amount).toBe(toMoney(10 * 167 * 1.34)); // 40,000 → 時薪 166.67 → 四捨五入 167
  });
});

describe('常用類別', () => {
  it('預設有三個加項、四個扣項，名稱與預設方式符合常見的薪資項目', () => {
    const categories = defaultCatalog().categories;
    expect(categories.filter((c) => c.side === 'addition').map((c) => c.name)).toEqual(['津貼', '獎金', '加給']);
    expect(categories.filter((c) => c.side === 'deduction').map((c) => [c.name, c.mode, c.value])).toEqual([
      ['勞保費', 'amount', 0], ['健保費', 'amount', 0], ['職工福利金', 'percent', 0.5], ['勞工自提退休金', 'percent', 0],
    ]);
  });

  it('從常用類別加入時帶入預設，並且之後每月沿用', () => {
    const welfare = defaultCatalog().categories.find((c) => c.name === '職工福利金')!;
    expect(itemFromCategory(welfare)).toMatchObject({ name: '職工福利金', mode: 'percent', value: 0.5, regular: true });
    expect(itemFromCategory(welfare).id).not.toBe(itemFromCategory(welfare).id);
  });

  it('檢查名稱、金額與比例，並分開計算加項與扣項的順序', () => {
    const base = defaultCatalog();
    expect(validateCatalog(base)).toBe('');
    const withBlank = { ...base, categories: [...base.categories, { id: 'x', name: ' ', side: 'deduction' as const, mode: 'amount' as const, value: 0 }] };
    expect(validateCatalog(withBlank)).toBe('第 5 個常用扣項要填名稱');
    const badPercent = { ...base, categories: [{ id: 'x', name: '自提', side: 'deduction' as const, mode: 'percent' as const, value: 120 }] };
    expect(validateCatalog(badPercent)).toBe('第 1 個常用扣項的比例要在 0 到 100 之間');
    const tooMany = { ...base, categories: Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, name: 'x', side: 'addition' as const, mode: 'amount' as const, value: 0 })) };
    expect(validateCatalog(tooMany)).toBe('常用類別最多 40 個');
  });
});

describe('設定的檢查與修復', () => {
  const valid = (): MonthPay => pay({ additions: [item('伙食津貼', 2400)], deductions: [item('勞保費', 900)] });

  it('合法的設定通過', () => {
    expect(validateMonthPay(valid())).toBe('');
    expect(validateMonthPay(pay({ jobType: 'parttime', baseSalary: 0, hourlyWage: 196 }))).toBe('');
  });

  it.each([
    [{ baseSalary: 0 }, '請填本薪'],
    [{ baseSalary: -1 }, '請填本薪'],
    [{ baseSalary: 99_999_999 }, '請填本薪'],
    [{ jobType: 'parttime', hourlyWage: 0 }, '請填時薪'],
    [{ additions: [item(' ', 1)] }, '第 1 個加項要填名稱'],
    [{ additions: [item('x', -5)] }, '第 1 個加項的金額要在 0 到 10,000,000 之間'],
    [{ additions: [item('x'.repeat(21), 5)] }, '第 1 個加項的名稱最多 20 個字'],
    [{ deductions: [item('', 1)] }, '第 1 個扣項要填名稱'],
    [{ deductions: [item('自提', 101, { mode: 'percent' })] }, '第 1 個扣項的比例要在 0 到 100 之間'],
    [{ deductions: [item('勞保', -1)] }, '第 1 個扣項的金額要在 0 到 10,000,000 之間'],
    [{ additions: [item('甲', 1), item('', 1)] }, '第 2 個加項要填名稱'],
  ])('拒絕 %j', (over, message) => {
    expect(validateMonthPay({ ...valid(), ...over } as MonthPay)).toBe(message);
  });

  it('項目數量有上限', () => {
    const many = Array.from({ length: 21 }, (_, i) => item(`a${i}`, 1));
    expect(validateMonthPay({ ...valid(), additions: many })).toBe('加項最多 20 項');
    expect(validateMonthPay({ ...valid(), deductions: many })).toBe('扣項最多 20 項');
  });

  it('讀到壞資料時修成安全的值，格式不對則回傳 null', () => {
    expect(normalizeMonthPay(null)).toBeNull();
    expect(normalizeMonthPay('x')).toBeNull();
    expect(normalizeMonthPay({ version: 2, jobType: 'fulltime' })).toBeNull();
    expect(normalizeMonthPay({ version: 1, jobType: 'boss' })).toBeNull();
    const cleaned = normalizeMonthPay({
      version: 1, jobType: 'parttime', baseSalary: 'abc', hourlyWage: 196.126, rounding: 'weird',
      additions: [{ id: '<script>', name: '  伙食  ', mode: 'amount', value: -5, regular: 'yes' }, null],
      deductions: [{ id: 'd1', name: 'x', mode: 'percent', value: 500, regular: true }, { name: 'y', value: 12.345 }],
    })!;
    expect(cleaned.baseSalary).toBe(0);
    expect(cleaned.hourlyWage).toBe(196.13);
    expect(cleaned.rounding).toBe('round');
    expect(cleaned.additions.map((a) => [a.name, a.value, a.regular])).toEqual([['伙食', 0, false], ['', 0, false]]); // regular 只有 true 才算
    expect(cleaned.additions[0].id).toMatch(/^[a-z0-9]+$/); // 不合法的 id 會換掉
    expect(cleaned.deductions.map((d) => [d.mode, d.value, d.regular])).toEqual([['percent', 0, true], ['amount', 12.35, false]]);
  });

  it('設定經過 JSON 轉換後內容不變', () => {
    const p = valid();
    expect(normalizeMonthPay(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const c = defaultCatalog();
    expect(normalizeCatalog(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it('整份薪資資料：月份格式不對的、內容壞掉的都丟掉', () => {
    const data = normalizePayData({
      catalog: defaultCatalog(),
      months: { '2026-11': valid(), '2026-13': valid(), 'x': valid(), '2026-12': { version: 9 } },
    });
    expect(Object.keys(data.months)).toEqual(['2026-11']);
    expect(data.catalog!.categories).toHaveLength(7);
    expect(normalizePayData(null)).toEqual({ catalog: null, months: {} });
    expect(normalizePayData({ catalog: 'x', months: [] })).toEqual({ catalog: null, months: {} });
  });
});

describe('用完整的時薪去乘，乘出來的金額再依設定進位', () => {
  // 本薪 29,500 → 時薪 122.9166…；加班 10 小時 → 10 × 122.9166… × 1.34 = 1647.0833…
  const overtime = (payRounding: 'none' | 'round' | 'ceil', over: Partial<MonthPay> = {}, entries = month(day([8, 18]))) =>
    line(computePay(pay({ baseSalary: 29500, rounding: 'none', payRounding, ...over }), entries, 0), 'overtime')!.amount;

  it('三種進位方式：不進位保留到分、四捨五入、無條件進位', () => {
    expect(overtime('none')).toBe(1647.08);
    expect(overtime('round')).toBe(1647);
    expect(overtime('ceil')).toBe(1648);
  });

  it('時薪不進位時，拿完整的數字去乘，不是顯示出來的兩位小數', () => {
    // 本薪 30,100 → 時薪 125.41666…；100 小時 × 1.34 = 16805.8333…
    // 如果先把時薪砍成 125.42 再乘，會變成 16806.28
    const hundredHours = month(...Array.from({ length: 10 }, () => day([6, 16])));
    expect(overtime('none', { baseSalary: 30100 }, hundredHours)).toBe(16805.83);
    expect(overtime('none', { baseSalary: 30100 }, hundredHours)).not.toBe(16806.28);
    expect(overtime('round', { baseSalary: 30100 }, hundredHours)).toBe(16806);
    expect(overtime('ceil', { baseSalary: 30100 }, hundredHours)).toBe(16806);
  });

  it('時薪先進位成整數時，就用那個整數去乘；金額的進位另外算', () => {
    // 時薪四捨五入成 123 → 10 × 123 × 1.34 = 1648.2
    expect(overtime('none', { rounding: 'round' })).toBe(1648.2);
    expect(overtime('round', { rounding: 'round' })).toBe(1648);
    expect(overtime('ceil', { rounding: 'round' })).toBe(1649);
  });

  it('預設是四捨五入到整數，跟以前的算法一樣', () => {
    expect(blankMonthPay().payRounding).toBe('round');
    expect(overtime('round')).toBe(toMoney(10 * (29500 / 240) * 1.34));
  });

  it('每一行金額都照設定進位：假日加給、休假日出勤、工資，以及比例與自己填的項目', () => {
    const holiday = month(day([8, 18], '國定假日'), day([9, 12], '休假'), day([9, 11], '例假'));
    const rows = (mode: 'none' | 'round' | 'ceil') =>
      computePay(pay({ baseSalary: 29500, rounding: 'none', payRounding: mode,
        additions: [item('津貼', 100.5)], deductions: [item('福利金', 0.5, { mode: 'percent' })] }), holiday, 0);
    // 國定假日 8 小時工資 = 8 × 122.9166… = 983.3333；休假 3 小時 = (2×1.34 + 1.67) × 122.9166… = 534.6875；福利金 0.5% × 29,500 = 147.5
    const none = rows('none');
    expect([line(none, 'holiday')!.amount, line(none, 'leave')!.amount, line(none, 'rest')!.amount]).toEqual([983.33, 983.33, 534.69]);
    expect(none.additions.at(-1)!.amount).toBe(100.5);
    expect(none.deductions[0].amount).toBe(147.5);
    const rounded = rows('round');
    expect([line(rounded, 'holiday')!.amount, line(rounded, 'rest')!.amount, rounded.additions.at(-1)!.amount, rounded.deductions[0].amount]).toEqual([983, 535, 101, 148]);
    const ceiled = rows('ceil');
    expect([line(ceiled, 'holiday')!.amount, line(ceiled, 'rest')!.amount, ceiled.additions.at(-1)!.amount, ceiled.deductions[0].amount]).toEqual([984, 535, 101, 148]);
  });

  it('工讀生的工資也照設定進位', () => {
    const wage = (mode: 'none' | 'round' | 'ceil') =>
      computePay(pay({ jobType: 'parttime', hourlyWage: 183.5, payRounding: mode }), month(day([9, 10.25])), null).additions[0].amount; // 1.25 小時 = 229.375
    expect([wage('none'), wage('round'), wage('ceil')]).toEqual([229.38, 229, 230]);
  });

  it('合計用「分」相加，不會出現 0.1 + 0.2 這種浮點數誤差', () => {
    const result = computePay(pay({ baseSalary: 36000, payRounding: 'none', additions: [item('甲', 0.1), item('乙', 0.2)], deductions: [item('丙', 0.3)] }), {}, 0);
    expect(result.additionTotal).toBe(36000.3);
    expect(result.deductionTotal).toBe(0.3);
    expect(result.net).toBe(36000);
    for (const l of [...result.additions, ...result.deductions]) expect(Number(l.amount.toFixed(2))).toBe(l.amount); // 每一行最多兩位小數
  });

  it('roundAmount：浮點數誤差不會讓整數多進 1，也不會出現 -0', () => {
    expect(roundAmount(402.00000000000006, 'ceil')).toBe(402);
    expect(roundAmount(402.0001, 'ceil')).toBe(403);
    expect(roundAmount(0, 'ceil')).toBe(0);
    expect(Object.is(roundAmount(0, 'ceil'), 0)).toBe(true);
    expect(roundAmount(2305.4999999999995, 'round')).toBe(2306);
    expect(roundAmount(147.5, 'none')).toBe(147.5);
    expect(roundAmount(1647.083333, 'none')).toBe(1647.08);
    expect(roundAmount(229.375, 'none')).toBe(229.38);
  });

  it('算式裡的時薪顯示完整的數字：除不盡的寫到四位小數再加「…」', () => {
    const result = computePay(pay({ baseSalary: 29500, rounding: 'none' }), month(day([8, 18])), 0);
    expect(line(result, 'overtime')!.detail).toBe('10 小時 × 時薪 122.9167… × 1.34');
    expect(line(computePay(pay(), month(day([8, 18])), 0), 'overtime')!.detail).toBe('10 小時 × 時薪 150 × 1.34');
  });

  it.each([
    [125.41666666666667, '125.4167…'],
    [122.91666666666667, '122.9167…'],
    [150, '150'],
    [137.5, '137.5'],
    [1647.0833333333335, '1,647.0833…'],
    [1647.08, '1,647.08'],
  ])('formatExact(%d) = %s', (value, text) => {
    expect(formatExact(value)).toBe(text);
  });

  it('設定視窗的範例：加班 10 小時乘出來的值與進位後的金額', () => {
    const preview = overtimePreview(pay({ baseSalary: 29500, rounding: 'none', payRounding: 'ceil' }));
    expect(preview.hourly).toBeCloseTo(122.9167, 4);
    expect(preview.rate).toBe(1.34);
    expect(preview.raw).toBeCloseTo(1647.0833, 4);
    expect(preview.amount).toBe(1648);
    expect(overtimePreview(pay({ jobType: 'parttime', hourlyWage: 183.5, payRounding: 'none' }), 1.25)).toMatchObject({ rate: 1, amount: 229.38 });
  });

  it('金額的進位方式要檢查；舊資料沒有這個欄位時視為四捨五入', () => {
    expect(validateMonthPay({ ...pay(), payRounding: 'floor' } as unknown as MonthPay)).toBe('請選擇金額的進位方式');
    const base = { version: 1, jobType: 'fulltime', baseSalary: 36000, hourlyWage: 0, rounding: 'ceil', additions: [], deductions: [] };
    expect(normalizeMonthPay(base)!.payRounding).toBe('round');
    expect(normalizeMonthPay({ ...base, payRounding: 'floor' })!.payRounding).toBe('round');
    expect(normalizeMonthPay({ ...base, payRounding: 'none' })!.payRounding).toBe('none');
    expect(normalizeMonthPay({ ...base, payRounding: 'ceil' })!.payRounding).toBe('ceil');
  });

  it('沿用前面的月份時，金額的進位方式也一起帶過去', () => {
    expect(resolveMonthPay({ '2026-11': pay({ payRounding: 'ceil' }) }, '2026-12')!.pay.payRounding).toBe('ceil');
  });
});

describe('金額顯示', () => {
  it('有小數的金額最多顯示兩位；固定位數時一律兩位', () => {
    expect(formatMoney(1647.08)).toBe('NT$ 1,647.08');
    expect(formatMoney(1647.1)).toBe('NT$ 1,647.1');
    expect(formatMoney(36000)).toBe('NT$ 36,000');
    expect(formatMoney(36000, true)).toBe('NT$ 36,000.00');
    expect(formatMoney(1647.1, true)).toBe('NT$ 1,647.10');
    expect(formatMoney(-12.5, true)).toBe('-NT$ 12.50');
  });
});

describe('基本工資與金額顯示', () => {
  it('依月份取得適用的基本工資', () => {
    expect(minimumWage('2026-11')).toEqual({ hourly: 196, monthly: 29500, year: 2026 });
    expect(minimumWage('2026-12').hourly).toBe(196);
    expect(minimumWage('2027-01')).toEqual({ hourly: 205, monthly: 30900, year: 2027 });
    expect(minimumWage('2030-05').hourly).toBe(205);
    expect(minimumWage('2020-01').hourly).toBe(196);
  });

  it('金額加千分位，負數放負號', () => {
    expect(formatMoney(48230)).toBe('NT$ 48,230');
    expect(formatMoney(0)).toBe('NT$ 0');
    expect(formatMoney(-1500)).toBe('-NT$ 1,500');
  });
});
