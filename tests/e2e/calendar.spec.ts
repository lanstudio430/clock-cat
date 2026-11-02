import { expect, test } from './fixtures';

test('週一開始，只顯示當月日期', async ({ app, page }) => {
  await app.open();
  const cells = page.locator('.grid > *');
  expect(await cells.evaluateAll((nodes) => nodes.slice(0, 8).map((n) => n.textContent?.trim()))).toEqual(['一', '二', '三', '四', '五', '六', '日', '合計']);
  await expect(page.getByRole('button', { name: /^11月\d+日/ })).toHaveCount(30);
  await expect(page.locator('.day.blank')).toHaveCount(12);
  await expect(page.getByTestId('week-total')).toHaveCount(6);
  const position = (name: string) => cells.evaluateAll((nodes, label) => nodes.findIndex((n) => n.getAttribute('aria-label') === label), name);
  expect(await position('11月1日')).toBe(14);
  expect(await position('11月30日')).toBe(48);
  await expect(app.day(11, 2).locator('.circle')).toHaveText('2');
});

test('有實際顯示實際、沒實際顯示原定，週合計跟著變', async ({ app, page, backend }) => {
  await app.open();
  const shown = (date: number) => app.day(11, date).locator('.time span').allTextContents();

  await app.edit(11, 2, { planned: [9.5, 21.5], actual: [9.5, 21.5] });
  await expect(app.editor).toBeHidden();
  expect(await app.label(11, 2)).toBe('實際 9.5 至 21.5');
  expect((await app.weekTotals())[1]).toBe('12h');

  await app.edit(11, 3, { planned: [9, 18], actual: [9.25, 21.75] });
  expect(await app.label(11, 3)).toBe('實際 9.25 至 21.75');
  expect(await shown(3)).toEqual(['9.25', '21.75']);
  expect((await app.weekTotals())[1]).toBe('24.5h');

  await app.edit(11, 4, { planned: [9, 18] });
  expect(await app.label(11, 4)).toBe('原定 09 至 18');
  expect(await shown(4)).toEqual(['09', '18']);
  expect((await app.weekTotals())[1]).toBe('33.5h');
  await expect(page.locator('main')).not.toContainText('NaN');

  await app.edit(11, 5, { actual: [6, 21.75] });
  expect(await app.label(11, 5)).toBe('實際 06 至 21.75');
  expect((await app.weekTotals())[1]).toBe('49.25h');

  // 補上實際會蓋過原定；清掉實際就回到原定
  await app.edit(11, 4, { actual: [10, 12] });
  expect([await app.label(11, 4), (await app.weekTotals())[1]]).toEqual(['實際 10 至 12', '42.25h']);
  await app.edit(11, 4, { actual: null });
  expect([await app.label(11, 4), (await app.weekTotals())[1]]).toEqual(['原定 09 至 18', '49.25h']);

  const color = await app.day(11, 3).locator('.time span').first().evaluate((n) => getComputedStyle(n).color);
  expect(color).toBe('rgb(185, 53, 45)');

  await app.edit(11, 8, { type: '例假' });
  await app.edit(11, 6, { type: '休假' });
  await app.edit(11, 7, { actual: [10, 14], type: '國定假日' });
  expect(await app.label(11, 8)).toBe('例假');
  expect(await app.label(11, 7)).toBe('實際 10 至 14，國定假日');
  expect((await app.weekTotals())[1]).toBe('53.25h');
  await expect(app.day(11, 8)).toHaveClass(/\boff\b/);
  await expect(app.day(11, 6)).toHaveClass(/\boff\b/);
  await expect(app.day(11, 7)).toHaveClass(/\bholiday\b/);
  await expect(app.day(11, 8).locator('.tag')).toHaveText('例假');
  await expect(app.day(11, 7).locator('.tag')).toHaveCount(0);

  await expect.poll(() => backend.shiftRows().length).toBe(7);
  expect(backend.shiftRows().find((row) => row[0] === '2026-11-03')).toEqual(['2026-11-03', '9', '18', '9.25', '21.75', '']);
});

test('編輯面板：時間選項、預先帶入、刪除與清除', async ({ app, backend }) => {
  backend.seed([
    { date: '2026-11-03', plannedStart: 9, plannedEnd: 18, actualStart: 9.25, actualEnd: 21.75 },
    { date: '2026-11-04', plannedStart: 9, plannedEnd: 18 },
    { date: '2026-11-07', actualStart: 10, actualEnd: 14, dayType: '國定假日' },
  ]);
  await app.open();

  await app.day(11, 12).click();
  const hours = app.editor.getByRole('radiogroup', { name: /小時/ }).getByRole('radio');
  await expect(hours).toHaveText(['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']);
  await expect(app.editor.getByRole('radiogroup', { name: /分鐘/ }).getByRole('radio')).toHaveText(['0', '.25', '.5', '.75']);
  // 還沒選小時不能選分鐘
  await expect(app.editor.getByRole('radio', { name: '.25', exact: true })).toBeDisabled();
  await expect(app.editor.getByRole('button', { name: /^原定/ })).toContainText('未填');
  await expect(app.editor.getByRole('button', { name: /^實際/ })).toContainText('未填，以原定為準');
  await expect(app.editor.getByRole('button', { name: '刪除' })).toHaveCount(0);
  await app.editor.getByRole('button', { name: '取消' }).click();
  await expect(app.editor).toBeHidden();

  // 有實際時預設打開實際分頁，並標示以這組為準
  await app.day(11, 3).click();
  await expect(app.editor.getByRole('button', { name: /^實際/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(app.editor.getByRole('button', { name: /^實際/ })).toContainText('以這組為準');
  await expect(app.editor.getByRole('button', { name: /^實際/ })).toContainText('9.25 → 21.75・12.5h');
  await expect(app.editor.getByRole('button', { name: /^上班/ })).toContainText('9.25');
  await expect(app.editor.getByRole('button', { name: /^下班/ })).toContainText('21.75');
  await expect(app.editor.getByRole('radio', { name: '09', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(app.editor.getByRole('radio', { name: '.25', exact: true })).toHaveAttribute('aria-checked', 'true');
  await app.editor.getByRole('button', { name: /^原定/ }).click();
  await expect(app.editor.getByRole('button', { name: /^上班/ })).toContainText('09');
  await expect(app.editor.locator('.bar')).toHaveCount(2);
  await expect(app.editor.getByRole('button', { name: '刪除' })).toBeVisible();
  await closeWithEscape(app);

  // 只有原定時預設打開原定分頁
  await app.day(11, 4).click();
  await expect(app.editor.getByRole('button', { name: /^原定/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(app.editor.getByRole('button', { name: /^原定/ })).toContainText('以這組為準');
  await app.editor.getByRole('button', { name: '刪除' }).click();
  await expect(app.editor).toBeHidden();
  expect(await app.label(11, 4)).toBe('');
  await expect.poll(() => backend.shiftRows().some((row) => row[0] === '2026-11-04')).toBe(false);

  // 假別可以改回「無」，原定可以整組清掉
  await app.edit(11, 7, { type: '' });
  expect(await app.label(11, 7)).toBe('實際 10 至 14');
  await app.edit(11, 3, { planned: null });
  expect(await app.label(11, 3)).toBe('實際 9.25 至 21.75');
  await expect.poll(() => backend.shiftRows().find((row) => row[0] === '2026-11-03')).toEqual(['2026-11-03', '', '', '9.25', '21.75', '']);
});

async function closeWithEscape(app: { page: import('@playwright/test').Page; editor: import('@playwright/test').Locator }) {
  await app.page.keyboard.press('Escape');
  await expect(app.editor).toBeHidden();
}

test('不合規則時留在面板並說明原因，不寫入試算表', async ({ app, backend }) => {
  await app.open();
  const error = app.editor.getByRole('alert');

  await app.edit(11, 10, {});
  await expect(error).toHaveText('請選擇上下班時間或假別');

  await app.setPair('原定', [18, 9]);
  await app.editor.getByRole('button', { name: '儲存' }).click();
  await expect(error).toHaveText('原定下班時間需要晚於上班時間');

  await app.setPair('原定', null);
  await app.setPair('實際', [9, 9]);
  await app.editor.getByRole('button', { name: '儲存' }).click();
  await expect(error).toHaveText('實際下班時間需要晚於上班時間');

  await app.setPair('實際', [9, null]);
  await app.editor.getByRole('button', { name: '儲存' }).click();
  await expect(error).toHaveText('實際上班與下班時間需要同時選擇');
  await expect(app.editor).toBeVisible();

  // 再選一次時間，錯誤訊息就消失
  await app.pick(18);
  await expect(error).toHaveCount(0);
  await app.page.keyboard.press('Escape');
  expect(backend.shiftRows()).toEqual([]);
});

test('跨月的週只算畫面上的月份', async ({ app, backend }) => {
  backend.seed([
    { date: '2026-10-26', actualStart: 8, actualEnd: 12 },
    { date: '2026-11-01', actualStart: 8, actualEnd: 10 },
    { date: '2026-11-30', actualStart: 9, actualEnd: 18 },
    { date: '2026-12-02', actualStart: 9, actualEnd: 10 },
  ]);
  await app.open();
  const totals = await app.weekTotals();
  expect([totals[0], totals[5]]).toEqual(['2h', '9h']);
  await expect(app.grandTotal).toHaveText('11h');
  await expect(app.day(10, 26)).toHaveCount(0);
  await expect(app.day(12, 2)).toHaveCount(0);

  await app.goToMonth(2026, 10);
  expect((await app.weekTotals()).at(-1)).toBe('4h');
  await expect(app.grandTotal).toHaveText('4h');
  await app.goToMonth(2026, 12);
  expect((await app.weekTotals())[0]).toBe('1h');
  await expect(app.grandTotal).toHaveText('1h');
});

test('應上班時數、加班時數與貓咪的話', async ({ app, backend, page }) => {
  backend.seed([
    { date: '2026-11-02', actualStart: 9, actualEnd: 21.5 },
    { date: '2026-11-03', actualStart: 9, actualEnd: 18 },
  ]);
  await app.open();
  const card = page.getByRole('region', { name: '本月進度' });
  const message = card.locator('.note');

  await expect(app.required).toHaveValue('');
  await expect(app.overtime).toHaveCount(0);
  await expect(message).toHaveText('填上時數，我幫你算加班');
  await expect(card.locator('.percent')).toHaveCount(0);

  await app.setRequired('176');
  await expect(app.overtime).toHaveText('-154.5h');
  await expect(message).toHaveText('還差 154.5 小時，加油喵');
  await expect(card.locator('.percent')).toHaveText('12%');
  await expect.poll(() => backend.monthRows()).toEqual([['2026-11', '176']]);

  await app.setRequired('21.5');
  await expect(app.overtime).toHaveText('0h');
  await expect(message).toHaveText('剛好達標，辛苦了喵！');
  await expect(card.getByRole('img', { name: '達標' })).toBeVisible();

  await app.setRequired('0');
  await expect(app.overtime).toHaveText('21.5h');
  await expect(app.overtime).toHaveClass(/plus/);

  await app.setRequired('10');
  await expect(message).toHaveText('達標啦，多了 11.5 小時，辛苦了喵！');

  await app.setRequired('-5');
  await expect(card.getByRole('alert')).toHaveText('-5 超出 0～744，已改回 10');
  await expect(app.required).toHaveValue('10');
  await app.setRequired('999');
  await expect(app.required).toHaveValue('10');
  await expect.poll(() => backend.monthRows()).toEqual([['2026-11', '10']]);

  await app.setRequired('');
  await expect(app.overtime).toHaveCount(0);
  await expect.poll(() => backend.monthRows()).toEqual([]);

  // 每個月各自的應上班時數；沒有班時貓咪提醒開始記錄
  await app.goToMonth(2026, 12);
  await expect(app.required).toHaveValue('');
  await app.setRequired('160.5');
  await expect(app.overtime).toHaveText('-160.5h');
  await expect(message).toHaveText('點日期開始記錄吧');
  await app.goToMonth(2026, 11);
  await expect(app.required).toHaveValue('');
});

test('月份標籤跨年、年份選單與今天按鈕', async ({ app, page }) => {
  await app.open();
  await expect(page.getByRole('button', { name: '2026 年 11 月' })).toHaveAttribute('aria-current', 'date');
  await expect(page.locator('.divider')).toHaveText(['2026', '2027']);

  await page.getByRole('button', { name: '2027 年 1 月' }).click();
  await expect(page.getByLabel('年份')).toHaveValue('2027');
  await expect(page.getByRole('button', { name: /^1月\d+日/ })).toHaveCount(31);

  await page.getByLabel('年份').selectOption('2025');
  await expect(page.getByRole('button', { name: '2025 年 1 月' })).toHaveAttribute('aria-current', 'date');

  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.getByRole('button', { name: '2026 年 11 月' })).toHaveAttribute('aria-current', 'date');
  await expect(app.day(11, 2).locator('.circle')).toHaveText('2');
});
