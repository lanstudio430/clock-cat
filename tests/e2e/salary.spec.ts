import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const card = (page: Page) => page.getByRole('region', { name: /薪資試算/ });
const monthDialog = (page: Page, month = '11 月') => page.getByRole('dialog', { name: `${month}薪資設定` });
const categoriesDialog = (page: Page) => page.getByRole('dialog', { name: '常用類別' });
const money = (page: Page, key: string) => page.locator(`[data-testid="pay-line"][data-key="${key}"] b`);
const netPay = (page: Page) => page.getByTestId('net-pay');
const lines = (page: Page, section: '加項' | '扣項') => card(page).getByRole('region', { name: section }).getByTestId('pay-line');
/** 某一區裡名稱含有 text 的那幾行 */
const lineWith = (page: Page, section: '加項' | '扣項', text: string) => lines(page, section).filter({ hasText: text });

const openMonthDialog = async (page: Page, month = '11 月') => {
  await page.getByRole('button', { name: /^(設定這個月|編輯本月)$/ }).click();
  const dialog = monthDialog(page, month);
  await expect(dialog).toBeVisible();
  return dialog;
};
const save = (dialog: Locator) => dialog.getByRole('button', { name: '儲存' }).click();
const chip = (dialog: Locator, side: '加項' | '扣項', name: string) =>
  dialog.getByRole('region', { name: side }).getByRole('button', { name, exact: true });

/**
 * 本薪 36,000（時薪 150）；加項：津貼 2,400、獎金 1,000；
 * 扣項：勞保費 900、健保費 600、職工福利金 0.5%（180）、勞工自提退休金 6%（2,160）。全部從常用類別快速加入。
 */
async function fillStandardMonth(dialog: Locator) {
  await dialog.getByLabel('本薪（每月）').fill('36000');
  await chip(dialog, '加項', '津貼').click();
  await dialog.getByLabel('加項 1 的金額').fill('2400');
  await chip(dialog, '加項', '獎金').click();
  await dialog.getByLabel('加項 2 的金額').fill('1000');
  await chip(dialog, '扣項', '勞保費').click();
  await dialog.getByLabel('扣項 1 的金額').fill('900');
  await chip(dialog, '扣項', '健保費').click();
  await dialog.getByLabel('扣項 2 的金額').fill('600');
  await chip(dialog, '扣項', '職工福利金').click(); // 預設 0.5%
  await chip(dialog, '扣項', '勞工自提退休金').click();
  await dialog.getByLabel('扣項 4 的比例').fill('6');
}

const item = (name: string, value: number, over: Record<string, unknown> = {}) => ({
  id: `i${name.length}${value}`, name, mode: 'amount', value, regular: true, ...over,
});
const monthPay = (over: Record<string, unknown> = {}) => ({
  version: 1, jobType: 'fulltime', baseSalary: 36000, hourlyWage: 0, rounding: 'round',
  additions: [item('伙食津貼', 2400)], deductions: [item('勞保費', 900)], ...over,
});
const payRow = (backend: { mock: { sheets: Record<string, { rows: string[][] }> } }, key: string) =>
  backend.mock.sheets['薪資設定']?.rows.find((row) => row[0] === key);

test('還沒設定時邀請設定；用常用類別快速加入，算出加項、扣項與實領', async ({ app, backend, page }) => {
  // 兩天各 6 小時 = 12 小時，應上班 10 小時 → 加班 2 小時 = 2 × 150 × 1.34 = 402
  backend.seed([
    { date: '2026-11-02', actualStart: 9, actualEnd: 15 },
    { date: '2026-11-03', actualStart: 9, actualEnd: 15 },
  ], { '2026-11': 10 });
  await app.open();
  await expect(card(page)).toContainText('11 月還沒有薪資設定');
  await expect(netPay(page)).toHaveCount(0);

  const dialog = await openMonthDialog(page);
  await expect(dialog.getByTestId('pay-scope')).toContainText('從 11 月起生效，不會影響更早的月份');
  await fillStandardMonth(dialog);
  await expect(dialog.getByTestId('hourly-preview')).toContainText('36,000 ÷ 30 ÷ 8 = 150 → 150 元');
  await save(dialog);

  await expect(dialog).toBeHidden();
  await expect(app.toast).toContainText('11 月薪資設定已儲存');
  await expect(netPay(page)).toHaveText('NT$ 35,962'); // 36,000 + 402 + 2,400 + 1,000 − 3,840
  await expect(page.getByTestId('addition-total')).toHaveText('NT$ 39,802');
  await expect(page.getByTestId('deduction-total')).toHaveText('-NT$ 3,840');

  // 加項與扣項分在兩個區塊
  await expect(lines(page, '加項').locator('b')).toHaveText(['NT$ 36,000', 'NT$ 402', 'NT$ 2,400', 'NT$ 1,000']);
  await expect(lines(page, '扣項').locator('b')).toHaveText(['-NT$ 900', '-NT$ 600', '-NT$ 180', '-NT$ 2,160']);
  await expect(lines(page, '加項')).toContainText(['本薪', '加班費', '津貼', '獎金']);
  await expect(lines(page, '扣項')).toContainText(['勞保費', '健保費', '職工福利金', '勞工自提退休金']);
  await expect(card(page)).toContainText('2 小時 × 時薪 150 × 1.34');
  await expect(card(page)).toContainText('時薪 150 元（本薪 ÷ 30 ÷ 8，四捨五入）');

  // 同步到試算表：這個月一列
  await expect(app.stamp).toHaveText('已同步');
  expect(JSON.parse(payRow(backend, 'month:2026-11')![1])).toMatchObject({ baseSalary: 36000, jobType: 'fulltime' });
});

test('預估實領的框框不旋轉', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  await app.open();
  await expect(netPay(page)).toBeVisible();
  const transform = await page.locator('.net').evaluate((node) => getComputedStyle(node).transform);
  expect(transform).toBe('none');
});

test('加項與扣項用不同顏色與符號區分', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  await app.open();
  const additions = card(page).getByRole('region', { name: '加項' });
  const deductions = card(page).getByRole('region', { name: '扣項' });
  const border = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).borderTopColor);
  expect(await border(additions)).toBe('rgb(35, 122, 72)'); // 綠
  expect(await border(deductions)).toBe('rgb(185, 53, 45)'); // 紅
  await expect(additions.getByTestId('addition-total')).toHaveText('NT$ 38,400');
  await expect(deductions.getByTestId('deduction-total')).toHaveText('-NT$ 900');
  // 扣項的每一行金額都帶負號，加項不帶
  await expect(deductions.getByTestId('pay-line').locator('b').first()).toHaveText('-NT$ 900');
  await expect(additions.getByTestId('pay-line').locator('b').first()).toHaveText('NT$ 36,000');
});

test('改日曆的時數，薪資馬上跟著變', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  backend.seed([{ date: '2026-11-02', actualStart: 9, actualEnd: 15 }], { '2026-11': 10 });
  await app.open();
  await expect(money(page, 'overtime')).toHaveCount(0); // 6 小時還沒到 10 小時
  await expect(card(page)).toContainText('還差 4 小時才達到應上班時數');
  await expect(netPay(page)).toHaveText('NT$ 37,500'); // 36,000 + 2,400 − 900

  await app.edit(11, 3, { actual: [9, 17] }); // 再加 8 小時：共 14 小時，加班 4 小時 = 804
  await expect(money(page, 'overtime')).toHaveText('NT$ 804');
  await expect(netPay(page)).toHaveText('NT$ 38,304');
  await app.setRequired('14');
  await expect(money(page, 'overtime')).toHaveCount(0);
  await expect(netPay(page)).toHaveText('NT$ 37,500');
});

test('沒填應上班時數時提醒，不亂算加班費', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  backend.seed([{ date: '2026-11-02', actualStart: 8, actualEnd: 18 }]);
  await app.open();
  await expect(card(page)).toContainText('填上應上班時數，才能算加班費');
  await expect(money(page, 'overtime')).toHaveCount(0);
});

test.describe('每個月各自的設定', () => {
  test('本薪調整只影響這個月起，更早的月份不受影響', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay({ baseSalary: 36000 }));
    await app.open();
    await expect(money(page, 'base')).toHaveText('NT$ 36,000');

    // 12 月沿用 11 月的設定，調薪到 40,000
    await app.goToMonth(2026, 12);
    await expect(page.getByTestId('inherit-note')).toHaveText('沿用 11 月的設定');
    await expect(money(page, 'base')).toHaveText('NT$ 36,000');
    const dialog = await openMonthDialog(page, '12 月');
    await expect(dialog.getByTestId('pay-scope')).toContainText('目前沿用 11 月的設定');
    await dialog.getByLabel('本薪（每月）').fill('40000');
    await save(dialog);
    await expect(money(page, 'base')).toHaveText('NT$ 40,000');
    await expect(page.getByTestId('inherit-note')).toHaveCount(0); // 現在有自己的設定

    // 回到 11 月：還是 36,000
    await app.goToMonth(2026, 11);
    await expect(money(page, 'base')).toHaveText('NT$ 36,000');
    // 沒有自己設定的 1 月沿用最近的 12 月
    await app.goToMonth(2027, 1);
    await expect(page.getByTestId('inherit-note')).toHaveText('沿用 12 月的設定');
    await expect(money(page, 'base')).toHaveText('NT$ 40,000');

    expect(JSON.parse(payRow(backend, 'month:2026-11')![1]).baseSalary).toBe(36000);
    expect(JSON.parse(payRow(backend, 'month:2026-12')![1]).baseSalary).toBe(40000);
  });

  test('「每月沿用」的項目會帶到之後的月份，「只限本月」的不會', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    await app.open();
    const dialog = await openMonthDialog(page);
    await dialog.getByRole('button', { name: '自訂加項' }).click(); // 非經常性：預設只限本月
    await dialog.getByLabel('加項 2 的名稱').fill('補發差額');
    await dialog.getByLabel('加項 2 的金額').fill('500');
    await expect(dialog.getByRole('button', { name: '加項 2 每月沿用到之後的月份' })).toHaveText('只限本月');
    await expect(dialog.getByRole('button', { name: '加項 1 每月沿用到之後的月份' })).toHaveText('每月沿用');
    await save(dialog);
    await expect(lines(page, '加項')).toContainText(['本薪', '伙食津貼', '補發差額']);

    await app.goToMonth(2026, 12);
    await expect(lines(page, '加項')).toContainText(['本薪', '伙食津貼']);
    await expect(lineWith(page, '加項', '補發差額')).toHaveCount(0);
    await expect(netPay(page)).toHaveText('NT$ 37,500');
  });

  test('可以把項目改成「每月沿用」或「只限本月」', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    await app.open();
    const dialog = await openMonthDialog(page);
    await dialog.getByRole('button', { name: '加項 1 每月沿用到之後的月份' }).click(); // 伙食津貼改成只限本月
    await expect(dialog.getByRole('button', { name: '加項 1 每月沿用到之後的月份' })).toHaveText('只限本月');
    await save(dialog);
    await app.goToMonth(2026, 12);
    await expect(lineWith(page, '加項', '伙食津貼')).toHaveCount(0);
    await expect(lineWith(page, '扣項', '勞保費')).toHaveCount(1);
  });

  test('某個月可以有不同的加項、扣項，各月互不干擾', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    await app.open();
    await app.goToMonth(2026, 12);
    const dialog = await openMonthDialog(page, '12 月');
    await chip(dialog, '加項', '獎金').click(); // 12 月才有的年終獎金
    await dialog.getByLabel('加項 2 的金額').fill('18000');
    await dialog.getByLabel('加項 2 的名稱').fill('年終獎金');
    await dialog.getByRole('button', { name: '刪除扣項 1' }).click(); // 12 月沒有勞保費這一項
    await save(dialog);
    await expect(lineWith(page, '加項', '年終獎金')).toHaveCount(1);
    await expect(page.getByTestId('deduction-total')).toHaveText('NT$ 0');
    await expect(card(page)).toContainText('這個月沒有扣項');

    await app.goToMonth(2026, 11);
    await expect(lineWith(page, '加項', '年終獎金')).toHaveCount(0);
    await expect(lineWith(page, '扣項', '勞保費')).toHaveCount(1);
  });

  test('比所有設定都早的月份還沒有設定，用最近的設定當草稿；不會影響到它', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    await app.open();
    await app.goToMonth(2026, 10);
    await expect(card(page)).toContainText('10 月還沒有薪資設定');
    const dialog = await openMonthDialog(page, '10 月');
    await expect(dialog.getByLabel('本薪（每月）')).toHaveValue('36000'); // 帶入最近的設定，省得重填
    await dialog.getByLabel('本薪（每月）').fill('34000');
    await save(dialog);
    await expect(money(page, 'base')).toHaveText('NT$ 34000'.replace('34000', '34,000'));

    await app.goToMonth(2026, 11);
    await expect(money(page, 'base')).toHaveText('NT$ 36,000'); // 11 月沒被 10 月影響
    expect(await app.queue()).toEqual([]);
  });

  test('清除本月設定：改回沿用前面的月份，要按兩次確認', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    backend.call('savePayMonth', '2026-12', monthPay({ baseSalary: 40000 }));
    await app.open();
    await app.goToMonth(2026, 12);
    await expect(money(page, 'base')).toHaveText('NT$ 40,000');

    const dialog = await openMonthDialog(page, '12 月');
    await dialog.getByRole('button', { name: '清除本月設定' }).click();
    await expect(dialog).toBeVisible(); // 第一次只是要求確認
    await dialog.getByRole('button', { name: '確定清除？' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('inherit-note')).toHaveText('沿用 11 月的設定');
    await expect(money(page, 'base')).toHaveText('NT$ 36,000');
    await expect.poll(() => payRow(backend, 'month:2026-12')).toBeUndefined();
    expect(payRow(backend, 'month:2026-11')).toBeDefined();

    // 還沒有自己設定的月份不會出現「清除」
    const again = await openMonthDialog(page, '12 月');
    await expect(again.getByRole('button', { name: '清除本月設定' })).toHaveCount(0);
  });
});

test.describe('常用類別', () => {
  test('預設有三個加項、四個扣項，可以在月份設定裡一鍵加入並帶入預設值', async ({ app, page }) => {
    await app.open();
    const dialog = await openMonthDialog(page);
    await expect(dialog.getByRole('region', { name: '加項' }).locator('.chip')).toHaveText(['津貼', '獎金', '加給', '自訂加項']);
    await expect(dialog.getByRole('region', { name: '扣項' }).locator('.chip')).toHaveText(['勞保費', '健保費', '職工福利金', '勞工自提退休金', '自訂扣項']);

    await chip(dialog, '扣項', '職工福利金').click();
    await expect(dialog.getByLabel('扣項 1 的名稱')).toHaveValue('職工福利金');
    await expect(dialog.getByLabel('扣項 1 的比例')).toHaveValue('0.5'); // 預設 0.5%
    await expect(dialog.getByLabel('扣項 1 的比例')).toBeFocused(); // 游標直接在金額上，可以馬上輸入
    await chip(dialog, '加項', '加給').click();
    await expect(dialog.getByLabel('加項 1 的金額')).toBeFocused();
    await dialog.getByRole('button', { name: '扣項 1 單位，現在是比例（%），點一下切換' }).click();
    await expect(dialog.getByLabel('扣項 1 的金額')).toBeVisible();
  });

  test('在一個地方新增、改名、設預設值、刪除；月份設定的快速加入會跟著變', async ({ app, backend, page }) => {
    await app.open();
    const month = await openMonthDialog(page);
    await month.getByRole('button', { name: '管理常用類別' }).first().click();
    const dialog = categoriesDialog(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '新增常用加項' }).click();
    await dialog.getByLabel('常用加項 4 的名稱').fill('伙食津貼');
    await dialog.getByLabel('常用加項 4 預設的金額').fill('2400');
    await dialog.getByRole('button', { name: '刪除常用扣項 4' }).click(); // 刪掉勞工自提退休金
    await dialog.getByLabel('常用扣項 3 的名稱').fill('福利金');
    await save(dialog);
    await expect(dialog).toBeHidden();
    await expect(month).toBeVisible(); // 月份設定還開著，沒填的內容沒有被洗掉
    await expect(app.toast).toContainText('常用類別已儲存');

    await expect(month.getByRole('region', { name: '加項' }).locator('.chip')).toHaveText(['津貼', '獎金', '加給', '伙食津貼', '自訂加項']);
    await expect(month.getByRole('region', { name: '扣項' }).locator('.chip')).toHaveText(['勞保費', '健保費', '福利金', '自訂扣項']);
    await chip(month, '加項', '伙食津貼').click();
    await expect(month.getByLabel('加項 1 的金額')).toHaveValue('2400'); // 帶入預設金額

    // 同步到試算表，常用類別是獨立的一列
    await expect(app.stamp).toHaveText('已同步');
    const catalog = JSON.parse(payRow(backend, 'catalog')![1]);
    expect(catalog.categories.map((c: { name: string }) => c.name)).toContain('伙食津貼');
    expect(catalog.categories).toHaveLength(7);
  });

  test('刪除常用類別不會動到已經加進月份的項目', async ({ app, backend, page }) => {
    backend.call('savePayMonth', '2026-11', monthPay());
    await app.open();
    await page.getByRole('button', { name: '常用類別' }).click();
    const dialog = categoriesDialog(page);
    for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: '刪除常用加項 1' }).click();
    await save(dialog);
    await expect(lineWith(page, '加項', '伙食津貼')).toHaveCount(1);
    const month = await openMonthDialog(page);
    await expect(month.getByRole('region', { name: '加項' }).locator('.chip')).toHaveText(['自訂加項']);
    await expect(month.getByRole('region', { name: '加項' })).toContainText('還沒有常用加項類別');
  });

  test('還原成預設的類別；取消不會改動；有錯誤會留在視窗裡', async ({ app, page }) => {
    await app.open();
    await page.getByRole('button', { name: '常用類別' }).click();
    const dialog = categoriesDialog(page);
    await dialog.getByRole('button', { name: '新增常用加項' }).click();
    await dialog.getByRole('button', { name: '儲存' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('第 4 個常用加項要填名稱');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '還原成預設的類別' }).click();
    await expect(dialog.getByLabel('常用加項 4 的名稱')).toHaveCount(0);
    await dialog.getByLabel('常用加項 1 的名稱').fill('改過但不存');
    await dialog.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '常用類別' }).click();
    await expect(categoriesDialog(page).getByLabel('常用加項 1 的名稱')).toHaveValue('津貼');
  });
});

test('時薪的三種進位方式：不進位、四捨五入、無條件進位', async ({ app, backend, page }) => {
  // 本薪 30,100 → 時薪 125.4166…；加班 10 小時
  backend.seed([{ date: '2026-11-02', actualStart: 8, actualEnd: 18 }], { '2026-11': 0 });
  await app.open();
  let dialog = await openMonthDialog(page);
  await dialog.getByLabel('本薪（每月）').fill('30100');
  const hourlyGroup = dialog.getByRole('radiogroup', { name: '時薪的進位方式' });
  const choose = (name: string) => hourlyGroup.getByRole('radio', { name }).click();

  await choose('不進位');
  await expect(dialog.getByTestId('hourly-preview')).toContainText('= 125.4167…，不進位，用完整的數字去乘');
  await choose('四捨五入');
  await expect(dialog.getByTestId('hourly-preview')).toContainText('= 125.4167… → 125 元');
  await choose('無條件進位');
  await expect(dialog.getByTestId('hourly-preview')).toContainText('= 125.4167… → 126 元');
  await save(dialog);
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,688'); // 10 × 126 × 1.34 = 1688.4
  await expect(card(page)).toContainText('時薪 126 元（本薪 ÷ 30 ÷ 8，無條件進位）');

  dialog = await openMonthDialog(page);
  await expect(dialog.getByRole('radiogroup', { name: '時薪的進位方式' }).getByRole('radio', { name: '無條件進位' })).toHaveAttribute('aria-checked', 'true'); // 記得上次的選擇
  await dialog.getByRole('radiogroup', { name: '時薪的進位方式' }).getByRole('radio', { name: '四捨五入' }).click();
  await save(dialog);
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,675'); // 10 × 125 × 1.34

  dialog = await openMonthDialog(page);
  await dialog.getByRole('radiogroup', { name: '時薪的進位方式' }).getByRole('radio', { name: '不進位' }).click();
  await save(dialog);
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,681'); // 10 × 125.4166… × 1.34 = 1680.58
  await expect(card(page)).toContainText('時薪 125.4167… 元（本薪 ÷ 30 ÷ 8，不進位，用完整的數字去乘）');
});

test('金額的進位方式：時薪乘出來的加班費可以不進位、四捨五入、無條件進位', async ({ app, backend, page }) => {
  // 本薪 29,500，時薪不進位 → 122.9166…；加班 10 小時 × 1.34 = 1647.0833…
  backend.seed([{ date: '2026-11-02', actualStart: 8, actualEnd: 18 }], { '2026-11': 0 });
  await app.open();
  let dialog = await openMonthDialog(page);
  await dialog.getByLabel('本薪（每月）').fill('29500');
  await dialog.getByRole('radiogroup', { name: '時薪的進位方式' }).getByRole('radio', { name: '不進位' }).click();
  const amountGroup = dialog.getByRole('radiogroup', { name: '金額的進位方式' });
  const preview = dialog.getByTestId('amount-preview');

  await expect(amountGroup.getByRole('radio', { name: '四捨五入' })).toHaveAttribute('aria-checked', 'true'); // 預設跟以前一樣
  await amountGroup.getByRole('radio', { name: '不進位' }).click();
  await expect(preview).toContainText('例：加班 10 小時 × 時薪 122.9167… × 1.34 = 1,647.0833… → NT$ 1,647.08');
  await amountGroup.getByRole('radio', { name: '無條件進位' }).click();
  await expect(preview).toContainText('→ NT$ 1,648');
  await amountGroup.getByRole('radio', { name: '四捨五入' }).click();
  await expect(preview).toContainText('→ NT$ 1,647');
  await amountGroup.getByRole('radio', { name: '不進位' }).click();
  await save(dialog);

  // 不進位：用完整的時薪去乘，每一行保留兩位小數
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,647.08');
  await expect(card(page)).toContainText('10 小時 × 時薪 122.9167… × 1.34');
  await expect(money(page, 'base')).toHaveText('NT$ 29,500.00');
  await expect(netPay(page)).toHaveText('NT$ 31,147.08');
  await expect(card(page)).toContainText('每一行金額：不進位，保留到小數第二位');

  dialog = await openMonthDialog(page);
  await expect(dialog.getByRole('radiogroup', { name: '金額的進位方式' }).getByRole('radio', { name: '不進位' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('radiogroup', { name: '金額的進位方式' }).getByRole('radio', { name: '無條件進位' }).click();
  await save(dialog);
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,648');
  await expect(money(page, 'base')).toHaveText('NT$ 29,500'); // 進位成整數後不再顯示小數
  await expect(netPay(page)).toHaveText('NT$ 31,148');

  dialog = await openMonthDialog(page);
  await dialog.getByRole('radiogroup', { name: '金額的進位方式' }).getByRole('radio', { name: '四捨五入' }).click();
  await save(dialog);
  await expect(money(page, 'overtime')).toHaveText('NT$ 1,647');
  await expect(card(page)).toContainText('每一行金額：四捨五入到整數');

  // 存進試算表，之後沒有自己設定的月份也沿用同樣的方式
  await expect(app.stamp).toHaveText('已同步');
  expect(JSON.parse(payRow(backend, 'month:2026-11')![1])).toMatchObject({ rounding: 'none', payRounding: 'round' });
  await app.goToMonth(2026, 12);
  await expect(card(page)).toContainText('每一行金額：四捨五入到整數');
});

test('國定假日、休假、例假的加給', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay({ additions: [], deductions: [] }));
  backend.seed([
    { date: '2026-11-02', actualStart: 9, actualEnd: 21 }, // 平日 12 小時
    { date: '2026-11-07', actualStart: 10, actualEnd: 15, dayType: '休假' }, // 休息日 5 小時
    { date: '2026-11-10', actualStart: 8, actualEnd: 19.75, dayType: '國定假日' }, // 11.75 小時
    { date: '2026-11-08', actualStart: 9, actualEnd: 13, dayType: '例假' }, // 例假 4 小時
    { date: '2026-11-17', dayType: '國定假日' }, // 只標假別，沒出勤
  ], { '2026-11': 20 });
  await app.open();

  // 平日 12 + 國定假日前 8 小時 = 20 小時，剛好 = 應上班時數，沒有平日加班
  await expect(money(page, 'overtime')).toHaveCount(0);
  await expect(money(page, 'holiday')).toHaveText('NT$ 1,200'); // 1 天 × 8 × 150
  await expect(money(page, 'leave')).toHaveText('NT$ 1,200');
  await expect(money(page, 'over-eight')).toHaveText('NT$ 840'); // 國定假日多 3.75 小時 (2×1.34 + 1.75×1.67) × 150
  await expect(money(page, 'rest')).toHaveText('NT$ 1,154'); // (2×1.34 + 3×1.67) × 150 = 1153.5
  await expect(card(page)).toContainText('1 天共 5 小時');
  await expect(netPay(page)).toHaveText('NT$ 40,394'); // 36,000 + 1,200 + 1,200 + 840 + 1,154
});

test('工讀生：時薪 × 工時，低於基本工資會提醒', async ({ app, backend, page }) => {
  backend.seed([
    { date: '2026-11-02', actualStart: 9, actualEnd: 15 },
    { date: '2026-11-03', actualStart: 9, actualEnd: 15 },
    { date: '2026-11-07', actualStart: 9, actualEnd: 15, dayType: '休假' }, // 假別也照時薪算
  ]);
  await app.open();
  const dialog = await openMonthDialog(page);
  await dialog.getByRole('radio', { name: /工讀生/ }).click();
  await expect(dialog.getByLabel('本薪（每月）')).toHaveCount(0);
  await expect(dialog.getByText('2026 年基本工資時薪 196 元')).toBeVisible();

  await dialog.getByLabel('時薪', { exact: true }).fill('150');
  await expect(dialog.getByRole('status')).toHaveText('低於 2026 年基本工資時薪 196 元');
  await save(dialog);
  await expect(card(page)).toContainText('時薪 150 元低於 2026 年基本工資時薪 196 元');

  const again = await openMonthDialog(page);
  await again.getByLabel('時薪', { exact: true }).fill('196');
  await expect(again.getByRole('status')).toHaveCount(0);
  await save(again);
  await expect(money(page, 'wage')).toHaveText('NT$ 3,528'); // 18 小時 × 196
  await expect(card(page)).toContainText('18 小時 × 時薪 196');
  await expect(netPay(page)).toHaveText('NT$ 3,528');
  await expect(money(page, 'overtime')).toHaveCount(0);
  await expect(card(page)).not.toContainText('填上應上班時數');
});

test('基本工資跟著月份：2027 年起時薪 205 元', async ({ app, page }) => {
  await app.open();
  const dialog = await openMonthDialog(page);
  await dialog.getByRole('radio', { name: /工讀生/ }).click();
  await expect(dialog.getByText('2026 年基本工資時薪 196 元')).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();

  await app.goToMonth(2027, 1);
  const again = await openMonthDialog(page, '1 月');
  await again.getByRole('radio', { name: /工讀生/ }).click();
  await expect(again.getByText('2027 年基本工資時薪 205 元')).toBeVisible();
});

test('儲存前檢查：本薪、名稱、金額', async ({ app, page }) => {
  await app.open();
  const dialog = await openMonthDialog(page);
  const error = dialog.getByRole('alert');

  await save(dialog);
  await expect(error).toHaveText('請填本薪');
  await dialog.getByLabel('本薪（每月）').fill('36000');
  await dialog.getByRole('button', { name: '自訂加項' }).click();
  await save(dialog);
  await expect(error).toHaveText('第 1 個加項要填名稱');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: '刪除加項 1' }).click();
  await chip(dialog, '扣項', '勞保費').click();
  await dialog.getByLabel('扣項 1 的名稱').fill('');
  await save(dialog);
  await expect(error).toHaveText('第 1 個扣項要填名稱');

  await dialog.getByLabel('扣項 1 的名稱').fill('團保');
  await dialog.getByRole('button', { name: '扣項 1 單位，現在是金額（NT$），點一下切換' }).click();
  await dialog.getByLabel('扣項 1 的比例').fill('150');
  await save(dialog);
  await expect(error).toHaveText('第 1 個扣項的比例要在 0 到 100 之間');

  await dialog.getByLabel('扣項 1 的比例').fill('1.5');
  await save(dialog);
  await expect(dialog).toBeHidden();
  await expect(lineWith(page, '扣項', '團保')).toHaveCount(1);
  await expect(lines(page, '扣項').locator('b')).toHaveText(['-NT$ 540']);
});

test('取消不會改動已存的設定', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  await app.open();
  const dialog = await openMonthDialog(page);
  await dialog.getByLabel('本薪（每月）').fill('99999');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(money(page, 'base')).toHaveText('NT$ 36,000');
  const again = await openMonthDialog(page);
  await expect(again.getByLabel('本薪（每月）')).toHaveValue('36000');
  await page.keyboard.press('Escape');
  await expect(again).toBeHidden();
});

test('重新開啟後設定還在；換一台裝置也會從試算表取回', async ({ app, backend, page }) => {
  await app.open();
  const dialog = await openMonthDialog(page);
  await fillStandardMonth(dialog);
  await save(dialog);
  await expect(app.stamp).toHaveText('已同步');
  const net = await netPay(page).textContent();

  await page.reload();
  await expect(netPay(page)).toHaveText(net!);

  // 另一台裝置：本機沒有快取，試算表有
  await page.evaluate(() => localStorage.removeItem('clockcat:pay'));
  await page.reload();
  await expect(netPay(page)).toHaveText(net!);
  expect(await page.evaluate(() => localStorage.getItem('clockcat:pay') !== null)).toBe(true);
  expect(payRow(backend, 'month:2026-11')).toBeDefined();
});

test('試算表的設定比本機新時，以試算表為準', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay({ baseSalary: 36000 }));
  await page.addInitScript((local) => localStorage.setItem('clockcat:pay', JSON.stringify(local)), { catalog: null, months: { '2026-11': monthPay({ baseSalary: 30000 }) } });
  await app.open();
  await expect(money(page, 'base')).toHaveText('NT$ 36,000');
});

test('本機有、試算表還沒有時（先設定再連線），自動送上去', async ({ app, backend, page }) => {
  await page.addInitScript((local) => localStorage.setItem('clockcat:pay', JSON.stringify(local)), {
    catalog: { version: 1, categories: [{ id: 'c1', name: '伙食津貼', side: 'addition', mode: 'amount', value: 2400 }] },
    months: { '2026-11': monthPay() },
  });
  await app.open();
  await expect(money(page, 'base')).toHaveText('NT$ 36,000');
  await expect.poll(() => payRow(backend, 'month:2026-11')?.[0]).toBe('month:2026-11');
  await expect.poll(() => payRow(backend, 'catalog')?.[0]).toBe('catalog');
});

test.describe('第一次連線', () => {
  test.use({ settings: null });

  test('先設定好的薪資，連線時不會被清掉', async ({ app, backend, page }) => {
    await page.addInitScript((local) => localStorage.setItem('clockcat:pay', JSON.stringify(local)), { catalog: null, months: { '2026-11': monthPay() } });
    await page.goto('./');
    const dialog = page.getByRole('dialog', { name: '連線設定' });
    await dialog.getByLabel('Apps Script 網址').fill('https://script.google.com/macros/s/TEST/exec');
    await dialog.getByRole('textbox', { name: '密鑰', exact: true }).fill('test-key');
    await dialog.getByRole('button', { name: '開始使用' }).click();

    await expect(app.stamp).toHaveText('已同步');
    await expect(money(page, 'base')).toHaveText('NT$ 36,000');
    await expect.poll(() => payRow(backend, 'month:2026-11')?.[0]).toBe('month:2026-11');
  });
});

test('換成另一份試算表時，本機的薪資設定也清掉，改拿新試算表的', async ({ app, backend, page }) => {
  backend.call('savePayMonth', '2026-11', monthPay());
  await app.open();
  await expect(netPay(page)).toBeVisible();

  await page.getByRole('button', { name: '連線設定' }).click();
  const dialog = page.getByRole('dialog', { name: '連線設定' });
  await dialog.getByLabel('Apps Script 網址').fill('https://script.google.com/macros/s/OTHER/exec');
  await dialog.getByRole('button', { name: '儲存' }).click();
  await expect(dialog).toBeHidden();
  await expect(app.stamp).toHaveText('已同步');
  // 這裡的假後端仍是同一份，所以會重新取回；重點是沒有沿用舊試算表留下的本機快取來蓋過它
  await expect(netPay(page)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:profiles')!).list[0].url)).toBe('https://script.google.com/macros/s/OTHER/exec');
});

test('離線時設定先存在本機，恢復連線後送出', async ({ app, backend, page }) => {
  await app.open();
  app.net.offline = true;
  const dialog = await openMonthDialog(page);
  await fillStandardMonth(dialog);
  await save(dialog);

  await expect(netPay(page)).toBeVisible();
  await expect(app.stamp).toHaveText('離線・1 筆待同步');
  expect(await app.queue()).toHaveLength(1);
  expect(payRow(backend, 'month:2026-11')).toBeUndefined();

  await page.reload();
  await expect(netPay(page)).toBeVisible(); // 重新開啟也還在

  app.net.offline = false;
  await app.stamp.click();
  await expect(app.stamp).toHaveText('已同步');
  expect(JSON.parse(payRow(backend, 'month:2026-11')![1]).baseSalary).toBe(36000);
});

test('後端還沒更新：月曆照常運作，薪資設定只存在這台裝置並說明原因', async ({ app, backend, page }) => {
  app.net.legacyBackend = true;
  await app.open();
  await expect(app.stamp).toHaveText('已同步'); // 不認得薪資設定不會讓整個 App 出錯
  await expect(page.getByRole('alert').filter({ hasText: '連線設定有問題' })).toHaveCount(0);

  const dialog = await openMonthDialog(page);
  await fillStandardMonth(dialog);
  await save(dialog);
  await expect(app.toast).toContainText('但後端還沒更新，只存在這台裝置');
  await expect(netPay(page)).toBeVisible();
  await expect(card(page)).toContainText('後端還沒更新，薪資設定只存在這台裝置');
  expect(await app.queue()).toEqual([]);
  expect(payRow(backend, 'month:2026-11')).toBeUndefined();

  // 之後的班表變更不受影響
  await app.edit(11, 5, { actual: [9, 18] });
  await expect(app.stamp).toHaveText('已同步');
  expect(backend.shiftRows()).toEqual([['2026-11-05', '', '', '9', '18', '']]);
});

test('還沒確認後端版本就儲存薪資：被舊後端拒絕時不會卡住其他變更', async ({ app, backend, page }) => {
  await app.open(); // 先快取月份
  app.net.offline = true;
  await page.reload(); // 這次開啟時沒連上，還不知道後端版本
  await expect(app.day(11, 2)).toBeEnabled();

  app.net.offline = false;
  app.net.legacyBackend = true;
  const dialog = await openMonthDialog(page);
  await fillStandardMonth(dialog);
  await save(dialog);
  await app.edit(11, 6, { actual: [9, 12] });

  await expect(app.toast.getByRole('alert')).toContainText('後端還沒更新');
  await expect.poll(() => app.queue()).toEqual([]);
  expect(backend.shiftRows()).toEqual([['2026-11-06', '', '', '9', '12', '']]);
  await expect(netPay(page)).toBeVisible();
});
