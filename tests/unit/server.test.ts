import { describe, expect, it } from 'vitest';
import { createBackend } from '../helpers/backend';

const entry = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-02',
  plannedStart: null,
  plannedEnd: null,
  actualStart: null,
  actualEnd: null,
  dayType: '',
  ...over,
});

describe('Code.gs 試算表讀寫', () => {
  it('第一次讀取時建立工作表與標題', () => {
    const backend = createBackend();
    expect(backend.call('getMonths', ['2026-11'])).toEqual({ '2026-11': { entries: [], requiredHours: null } });
    expect(backend.mock.sheets['班表'].rows[0]).toEqual(['日期', '原定上班', '原定下班', '實際上班', '實際下班', '假別']);
    expect(backend.mock.sheets['月設定'].rows[0]).toEqual(['月份', '應上班時數']);
  });

  it.each([6, 6.25, 9.5, 21.75, '9.5'])('接受時間 %s', (value) => {
    expect(createBackend().call('normalizeTime_', value)).toBe(Number(value));
  });

  it.each(['', null, undefined])('空白時間 %s 視為未填', (value) => {
    expect(createBackend().call('normalizeTime_', value)).toBeNull();
  });

  it.each([5.75, 22, 9.1, 9.3, 'abc', ' ', '=SUM(A1)', -1, NaN])('拒絕時間 %s', (value) => {
    expect(() => createBackend().context.normalizeTime_(value)).toThrow();
  });

  it.each(['2026-02-30', '2026-13-01', '26-1-1', '', 'x', '=1+1'])('拒絕日期 %s', (date) => {
    expect(() => createBackend().context.saveEntry(entry({ date, dayType: '例假' }))).toThrow();
  });

  it('拒絕不合規則的紀錄', () => {
    const { context } = createBackend();
    expect(() => context.saveEntry(entry({ dayType: '=HACK()' }))).toThrow('假別不正確');
    expect(() => context.saveEntry(entry())).toThrow('請選擇上下班時間或假別');
    expect(() => context.saveEntry(entry({ plannedStart: 9 }))).toThrow('原定上班與下班時間需要同時選擇');
    expect(() => context.saveEntry(entry({ actualStart: 18, actualEnd: 9 }))).toThrow('實際下班時間需要晚於上班時間');
  });

  it('同一天只留一列，欄位都存成文字', () => {
    const backend = createBackend();
    backend.call('saveEntry', entry({ plannedStart: 9, plannedEnd: 21.5, actualStart: 9.25, actualEnd: 21.75 }));
    backend.call('saveEntry', entry({ date: '2026-11-03', dayType: '例假' }));
    backend.call('saveEntry', entry({ actualStart: 10, actualEnd: 18, dayType: '休假' }));
    expect(backend.shiftRows()).toEqual([
      ['2026-11-02', '', '', '10', '18', '休假'],
      ['2026-11-03', '', '', '', '', '例假'],
    ]);
    expect(backend.call<any>('getMonths', ['2026-11'])['2026-11'].entries[0]).toEqual({
      date: '2026-11-02', plannedStart: null, plannedEnd: null, actualStart: 10, actualEnd: 18, dayType: '休假',
    });
    backend.call('deleteEntry', '2026-11-02');
    backend.call('deleteEntry', '2026-11-02');
    expect(backend.shiftRows().map((row) => row[0])).toEqual(['2026-11-03']);
  });

  it('依月份分組，略過格式不對的日期', () => {
    const backend = createBackend();
    backend.seed([
      { date: '2026-10-31', dayType: '休假' },
      { date: '2026-11-03', dayType: '例假' },
      { date: '2026-12-01', dayType: '休假' },
    ]);
    backend.mock.sheets['班表'].rows.push(['2026-11-3', '', '', '9', '10', ''], ['2026-11-xx', '', '', '9', '10', ''], ['x2026-11-05', '', '', '9', '10', '']);
    const months = backend.call<Record<string, { entries: { date: string }[] }>>('getMonths', ['2026-10', '2026-11', '2026-12']);
    expect(Object.entries(months).map(([key, value]) => [key, value.entries.map((e) => e.date)])).toEqual([
      ['2026-10', ['2026-10-31']],
      ['2026-11', ['2026-11-03']],
      ['2026-12', ['2026-12-01']],
    ]);
  });

  it.each([[[]], [null], ['x'], [['2026-13']], [['2026-1']], [['2026-11', 'x']], [['=1+1']], [['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']]])(
    'getMonths 拒絕 %j',
    (months) => {
      expect(() => createBackend().context.getMonths(months)).toThrow();
    },
  );

  it('應上班時數可存、可改、可清除，0 也是有效值', () => {
    const backend = createBackend();
    const required = (month: string) => backend.call<any>('getMonths', [month])[month].requiredHours;
    expect(backend.call('saveRequiredHours', '2026-11', '176.5')).toBe(176.5);
    expect(required('2026-11')).toBe(176.5);
    backend.call('saveRequiredHours', '2026-11', '180');
    expect(backend.monthRows()).toEqual([['2026-11', '180']]);
    expect(backend.call('saveRequiredHours', '2026-12', 0)).toBe(0);
    expect(required('2026-12')).toBe(0);
    expect(backend.call('saveRequiredHours', '2026-11', '')).toBeNull();
    expect(backend.call('saveRequiredHours', '2026-11', null)).toBeNull();
    expect(required('2026-11')).toBeNull();
    for (const bad of ['-1', '745', 'abc']) expect(() => backend.context.saveRequiredHours('2026-11', bad)).toThrow();
    for (const bad of ['2026-13', '2026-1', 'x', '=1+1']) expect(() => backend.context.saveRequiredHours(bad, 1)).toThrow();
  });
});

describe('Code.gs API 與密鑰', () => {
  const setup = () => {
    const backend = createBackend({ key: null });
    const post = (body: unknown) => JSON.parse(backend.handle(typeof body === 'string' ? body : JSON.stringify(body)));
    return { backend, post };
  };

  it('連線測試不需要密鑰，也不回傳資料', () => {
    const { backend } = setup();
    expect(JSON.parse(backend.context.doGet().getContent())).toEqual({ ok: true, data: 'Clock Cat API' });
  });

  it('還沒產生密鑰前一律拒絕', () => {
    const { backend, post } = setup();
    expect(post({ key: 'x', action: 'getMonths', months: ['2026-11'] }).code).toBe('not_configured');
    backend.mock.props.API_KEY = '';
    expect(post({ key: '', action: 'getMonths', months: ['2026-11'] }).code).toBe('not_configured');
  });

  it('setupApiKey 產生 64 位十六進位密鑰，重跑不會換掉', () => {
    const { backend } = setup();
    backend.context.setupApiKey();
    const key = backend.mock.props.API_KEY;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    backend.context.setupApiKey();
    expect(backend.mock.props.API_KEY).toBe(key);
  });

  it('只接受完全相同的密鑰', () => {
    const { backend, post } = setup();
    backend.context.setupApiKey();
    const key = backend.mock.props.API_KEY;
    const months = { action: 'getMonths', months: ['2026-11'] };
    expect(post({ key, ...months })).toEqual({ ok: true, data: { '2026-11': { entries: [], requiredHours: null } } });
    const wrongKeys = ['x'.repeat(64), key.slice(0, 63) + (key[63] === 'a' ? 'b' : 'a'), key.slice(1), key + 'a', '', 12345, null, [key], { key }];
    for (const wrong of wrongKeys) expect(post({ key: wrong, ...months }).code).toBe('unauthorized');
    expect(post(months).code).toBe('unauthorized');
    expect('data' in post({ key: 'x', ...months })).toBe(false);
    const before = backend.shiftRows().length;
    post({ key: 'x', action: 'saveEntry', entry: entry({ dayType: '例假' }) });
    expect(backend.shiftRows().length).toBe(before);
  });

  it('格式不對的請求不會出錯當機', () => {
    const { backend, post } = setup();
    backend.context.setupApiKey();
    const key = backend.mock.props.API_KEY;
    for (const bad of ['', 'not json', '{', 'null', '[]', 'undefined']) expect(post(bad).ok).toBe(false);
    expect(post('{').code).toBe('bad_request');
    expect(JSON.parse(backend.context.doPost({}).getContent()).ok).toBe(false);
    expect(JSON.parse(backend.context.doPost(undefined).getContent()).ok).toBe(false);
    for (const action of ['nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', undefined]) {
      expect(post({ key, action }).code).toBe('bad_request');
    }
  });

  it('透過 API 讀寫，驗證錯誤回傳 rejected 與原因', () => {
    const { backend, post } = setup();
    backend.context.setupApiKey();
    const key = backend.mock.props.API_KEY;
    const day = entry({ plannedStart: 9, plannedEnd: 18 });
    expect(post({ key, action: 'saveEntry', entry: day })).toEqual({ ok: true, data: day });
    expect(post({ key, action: 'getMonths', months: ['2026-11'] }).data['2026-11'].entries).toEqual([day]);
    expect(post({ key, action: 'saveEntry', entry: { ...day, dayType: 'x' } }).code).toBe('rejected');
    expect(post({ key, action: 'saveEntry', entry: { ...day, plannedStart: null } }).error).toBe('原定上班與下班時間需要同時選擇');
    expect(post({ key, action: 'saveEntry' }).ok).toBe(false);
    expect(post({ key, action: 'deleteEntry', date: '2026-11-02' })).toEqual({ ok: true, data: null });
    expect(post({ key, action: 'saveRequiredHours', month: '2026-11', value: 176 })).toEqual({ ok: true, data: 176 });
    expect(post({ key, action: 'saveRequiredHours', month: '2026-11', value: null })).toEqual({ ok: true, data: null });
    expect(post({ key, action: 'saveRequiredHours', month: '2026-13', value: 1 }).code).toBe('rejected');
  });

  it('拿不到鎖時回傳 busy，前端會稍後重試', () => {
    const { backend, post } = setup();
    backend.context.setupApiKey();
    const key = backend.mock.props.API_KEY;
    backend.mock.failLocks(true);
    expect(post({ key, action: 'saveEntry', entry: entry({ dayType: '例假' }) }).code).toBe('busy');
  });
});

describe('Code.gs 薪資設定', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'i1', name: '伙食津貼', mode: 'amount', value: 2400, regular: true, ...over });
  const monthPay = (over: Record<string, unknown> = {}) => ({
    version: 1,
    jobType: 'fulltime',
    baseSalary: 36000,
    hourlyWage: 0,
    rounding: 'round',
    payRounding: 'round',
    additions: [item()],
    deductions: [item({ id: 'd1', name: '勞保費', value: 900 }), item({ id: 'd2', name: '職工福利金', mode: 'percent', value: 0.5, regular: false })],
    ...over,
  });
  const catalog = (over: Record<string, unknown> = {}) => ({
    version: 1,
    categories: [
      { id: 'c1', name: '津貼', side: 'addition', mode: 'amount', value: 0 },
      { id: 'c2', name: '職工福利金', side: 'deduction', mode: 'percent', value: 0.5 },
    ],
    ...over,
  });
  const sheetRows = (backend: ReturnType<typeof createBackend>) => backend.mock.sheets['薪資設定']?.rows.slice(1) ?? [];

  it('還沒設定過時，沒有常用類別也沒有任何月份', () => {
    const backend = createBackend();
    expect(backend.call('getPayData')).toEqual({ catalog: null, months: {} });
    expect(backend.mock.sheets['薪資設定'].rows[0]).toEqual(['項目', '內容']);
  });

  it('每個月各存一列，互不影響；重存同一個月是整份取代', () => {
    const backend = createBackend();
    expect(backend.call('savePayMonth', '2026-11', monthPay())).toEqual(monthPay());
    backend.call('savePayMonth', '2026-12', monthPay({ baseSalary: 40000 }));
    expect(backend.call<any>('getPayData').months['2026-11'].baseSalary).toBe(36000);
    expect(backend.call<any>('getPayData').months['2026-12'].baseSalary).toBe(40000);

    backend.call('savePayMonth', '2026-11', monthPay({ baseSalary: 37000, additions: [] }));
    const months = backend.call<any>('getPayData').months;
    expect(months['2026-11'].baseSalary).toBe(37000);
    expect(months['2026-11'].additions).toEqual([]);
    expect(months['2026-12'].baseSalary).toBe(40000); // 另一個月沒被動到
    expect(sheetRows(backend).map((row) => row[0])).toEqual(['month:2026-11', 'month:2026-12']); // 沒有重複列
  });

  it('傳 null 代表清除這個月自己的設定，其他月份和常用類別不受影響', () => {
    const backend = createBackend();
    backend.call('savePayMonth', '2026-11', monthPay());
    backend.call('savePayMonth', '2026-12', monthPay());
    backend.call('savePayCatalog', catalog());
    expect(backend.call('savePayMonth', '2026-11', null)).toBeNull();
    expect(backend.call('savePayMonth', '2026-11', null)).toBeNull(); // 重複清除沒關係
    const data = backend.call<any>('getPayData');
    expect(Object.keys(data.months)).toEqual(['2026-12']);
    expect(data.catalog.categories).toHaveLength(2);
  });

  it('常用類別存成獨立一列，整份取代', () => {
    const backend = createBackend();
    expect(backend.call('savePayCatalog', catalog())).toEqual(catalog());
    backend.call('savePayCatalog', catalog({ categories: [] }));
    expect(backend.call<any>('getPayData').catalog.categories).toEqual([]);
    expect(sheetRows(backend).map((row) => row[0])).toEqual(['catalog']);
  });

  it('內容以純文字存放，前面是 = 也不會被當成公式', () => {
    const backend = createBackend();
    backend.call('savePayMonth', '2026-11', monthPay({ additions: [item({ name: '=HYPERLINK("x")' })] }));
    expect(sheetRows(backend)[0][1].startsWith('{')).toBe(true);
    expect(backend.call<any>('getPayData').months['2026-11'].additions[0].name).toBe('=HYPERLINK("x")');
  });

  it('金額的進位方式三種都能存；舊版沒有這個欄位時視為四捨五入', () => {
    const backend = createBackend();
    for (const mode of ['none', 'round', 'ceil']) {
      expect(backend.call<any>('savePayMonth', '2026-11', monthPay({ payRounding: mode })).payRounding).toBe(mode);
      expect(backend.call<any>('getPayData').months['2026-11'].payRounding).toBe(mode);
    }
    const { payRounding, ...legacy } = monthPay();
    expect(payRounding).toBe('round');
    expect(backend.call<any>('savePayMonth', '2026-12', legacy).payRounding).toBe('round');
  });

  it('金額與名稱會整理：兩位小數、去掉前後空白', () => {
    const saved = createBackend().call<any>('savePayMonth', '2026-11', monthPay({
      baseSalary: 36000.126,
      additions: [item({ name: '  伙食津貼  ', value: 10.005 })],
    }));
    expect(saved.baseSalary).toBe(36000.13);
    expect(saved.additions[0]).toEqual(item({ value: 10.01 }));
  });

  it.each([
    ['是文字', 'x'],
    ['是數字', 5],
    ['沒有帶內容', undefined],
    ['版本不對', monthPay({ version: 2 })],
    ['身分不對', monthPay({ jobType: 'boss' })],
    ['進位方式不對', monthPay({ rounding: 'floor' })],
    ['金額進位方式不對', monthPay({ payRounding: 'floor' })],
    ['金額進位方式是數字', monthPay({ payRounding: 1 })],
    ['本薪是負數', monthPay({ baseSalary: -1 })],
    ['本薪太大', monthPay({ baseSalary: 10_000_001 })],
    ['本薪是文字', monthPay({ baseSalary: '36000' })],
    ['本薪是 NaN', monthPay({ baseSalary: NaN })],
    ['時薪是負數', monthPay({ hourlyWage: -5 })],
    ['加項不是陣列', monthPay({ additions: 'x' })],
    ['加項沒有名稱', monthPay({ additions: [item({ name: '  ' })] })],
    ['名稱太長', monthPay({ additions: [item({ name: 'x'.repeat(21) })] })],
    ['代碼含特殊字元', monthPay({ additions: [item({ id: '<b>' })] })],
    ['計算方式不對', monthPay({ deductions: [item({ mode: 'ratio' })] })],
    ['比例超過 100', monthPay({ deductions: [item({ mode: 'percent', value: 101 })] })],
    ['扣項金額是負數', monthPay({ deductions: [item({ value: -1 })] })],
    ['缺少每月沿用的設定', monthPay({ additions: [{ id: 'i1', name: '伙食', mode: 'amount', value: 1 }] })],
    ['每月沿用不是布林值', monthPay({ additions: [item({ regular: 'yes' })] })],
    ['項目太多', monthPay({ additions: Array.from({ length: 21 }, (_, i) => item({ id: `a${i}` })) })],
  ])('拒絕：%s', (_name, bad) => {
    const backend = createBackend();
    expect(() => backend.context.savePayMonth('2026-11', bad)).toThrow();
    expect(sheetRows(backend)).toEqual([]); // 沒有寫入任何資料
  });

  it.each([
    ['月份格式不對', '2026-13'],
    ['月份是文字', 'x'],
    ['月份前面多了字', 'month:2026-11'],
  ])('拒絕：%s', (_name, month) => {
    expect(() => createBackend().context.savePayMonth(month, monthPay())).toThrow();
  });

  it.each([
    ['版本不對', catalog({ version: 2 })],
    ['類別不是陣列', catalog({ categories: 'x' })],
    ['太多類別', catalog({ categories: Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, name: 'x', side: 'addition', mode: 'amount', value: 0 })) })],
    ['加項或扣項不對', catalog({ categories: [{ id: 'c1', name: 'x', side: 'both', mode: 'amount', value: 0 }] })],
    ['沒有名稱', catalog({ categories: [{ id: 'c1', name: '', side: 'addition', mode: 'amount', value: 0 }] })],
    ['比例超過 100', catalog({ categories: [{ id: 'c1', name: 'x', side: 'deduction', mode: 'percent', value: 500 }] })],
  ])('常用類別拒絕：%s', (_name, bad) => {
    const backend = createBackend();
    expect(() => backend.context.savePayCatalog(bad)).toThrow();
    expect(sheetRows(backend)).toEqual([]);
  });

  it('壞掉的內容讀出來當作沒設定，不影響其他月份', () => {
    const backend = createBackend();
    backend.call('savePayMonth', '2026-11', monthPay());
    backend.call('savePayMonth', '2026-12', monthPay());
    backend.mock.sheets['薪資設定'].rows[1][1] = '{壞掉';
    expect(Object.keys(backend.call<any>('getPayData').months)).toEqual(['2026-12']);
  });

  it('透過 API：需要密鑰，錯誤回傳 rejected 與原因', () => {
    const backend = createBackend();
    const post = (body: unknown) => JSON.parse(backend.handle(JSON.stringify(body)));
    expect(post({ key: 'wrong', action: 'getPayData' }).code).toBe('unauthorized');
    expect(post({ key: 'wrong', action: 'savePayMonth', month: '2026-11', pay: monthPay() }).code).toBe('unauthorized');
    expect(post({ key: 'wrong', action: 'savePayCatalog', catalog: catalog() }).code).toBe('unauthorized');
    expect(backend.mock.sheets['薪資設定']).toBeUndefined();

    expect(post({ key: 'test-key', action: 'getPayData' })).toEqual({ ok: true, data: { catalog: null, months: {} } });
    expect(post({ key: 'test-key', action: 'savePayMonth', month: '2026-11', pay: monthPay() })).toEqual({ ok: true, data: monthPay() });
    expect(post({ key: 'test-key', action: 'savePayCatalog', catalog: catalog() })).toEqual({ ok: true, data: catalog() });
    expect(post({ key: 'test-key', action: 'getPayData' }).data).toEqual({ catalog: catalog(), months: { '2026-11': monthPay() } });
    expect(post({ key: 'test-key', action: 'savePayMonth', month: '2026-11', pay: null })).toEqual({ ok: true, data: null });

    const bad = post({ key: 'test-key', action: 'savePayMonth', month: '2026-11', pay: monthPay({ baseSalary: -1 }) });
    expect(bad.code).toBe('rejected');
    expect(bad.error).toContain('本薪');
    expect(post({ key: 'test-key', action: 'savePayMonth', month: '2026-11' }).ok).toBe(false); // 沒帶 pay 不能當成清除
  });

  it('舊的動作名稱不再支援', () => {
    const backend = createBackend();
    expect(JSON.parse(backend.handle(JSON.stringify({ key: 'test-key', action: 'getProfile' }))).code).toBe('bad_request');
  });

  it('寫入時拿不到鎖會回傳 busy', () => {
    const backend = createBackend();
    backend.mock.failLocks(true);
    expect(JSON.parse(backend.handle(JSON.stringify({ key: 'test-key', action: 'savePayMonth', month: '2026-11', pay: monthPay() }))).code).toBe('busy');
  });
});

describe('Code.gs 舊版班表升級', () => {
  it('四欄舊格式轉成新欄位，重跑結果不變', () => {
    const backend = createBackend();
    const sheet = backend.mock.globals.SpreadsheetApp.getActiveSpreadsheet().insertSheet('班表');
    sheet.rows.push(
      ['日期', '上班', '下班', '假別'],
      ['2026-11-02', '09:00', '21:30', ''],
      ['2026-11-03', '09:15', '18:45', '國定假日'],
      ['2026-11-08', '', '', '例假'],
      ['2026-11-09', '09:10', '18:00', ''],
    );
    const expected = [
      { date: '2026-11-02', plannedStart: null, plannedEnd: null, actualStart: 9, actualEnd: 21.5, dayType: '' },
      { date: '2026-11-03', plannedStart: null, plannedEnd: null, actualStart: 9.25, actualEnd: 18.75, dayType: '國定假日' },
      { date: '2026-11-08', plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, dayType: '例假' },
      { date: '2026-11-09', plannedStart: null, plannedEnd: null, actualStart: 9.17, actualEnd: 18, dayType: '' },
    ];
    const read = () => backend.call<any>('getMonths', ['2026-11'])['2026-11'].entries;
    expect(read()).toEqual(expected);
    expect(sheet.rows[0]).toEqual(['日期', '原定上班', '原定下班', '實際上班', '實際下班', '假別']);
    expect(read()).toEqual(expected);
  });

  it('只有標題的舊班表也能升級', () => {
    const backend = createBackend();
    const sheet = backend.mock.globals.SpreadsheetApp.getActiveSpreadsheet().insertSheet('班表');
    sheet.rows.push(['日期', '上班', '下班', '假別']);
    expect(backend.call<any>('getMonths', ['2026-11'])['2026-11'].entries).toEqual([]);
    expect(sheet.rows[0][3]).toBe('實際上班');
  });
});
