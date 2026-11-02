import { expect, test } from './fixtures';

test('桌面版：月份在頂列，側欄放本月卡；點日期時側欄換成編輯卡', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-03', plannedStart: 9, plannedEnd: 18 }], { '2026-11': 176 });
  await app.open();

  await expect(page.locator('header').getByRole('navigation', { name: '月份' })).toBeVisible();
  const aside = page.locator('aside');
  await expect(aside.getByRole('region', { name: '本月進度' })).toBeVisible();
  await expect(aside.getByRole('region', { name: '圖例' })).toBeVisible();

  await app.day(11, 3).click();
  await expect(aside.locator('[aria-labelledby="editor-title"]')).toBeVisible();
  await expect(aside.getByRole('region', { name: '圖例' })).toHaveCount(0);
  await expect(app.day(11, 3)).toHaveClass(/selected/);
  const columns = await app.editor.getByRole('radiogroup', { name: /小時/ }).evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(4);

  // 編輯時點另一天，直接換成那一天
  await app.day(11, 4).click();
  await expect(app.editor).toContainText('11月4日');
  await app.setPair('實際', [9.5, 18]);
  await app.editor.getByRole('button', { name: '儲存' }).click();
  await expect(aside.getByRole('region', { name: '圖例' })).toBeVisible();
  expect(await app.label(11, 4)).toBe('實際 9.5 至 18');
  await expect(app.overtime).toHaveText('-158.5h');

  await app.day(11, 3).click();
  await app.editor.getByRole('button', { name: '關閉' }).click();
  await expect(app.editor).toHaveCount(0);
});
