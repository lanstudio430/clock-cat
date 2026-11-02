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

test('桌面版：薪資卡在日曆下方，設定視窗在視窗高度內可捲動，儲存鈕一直看得到', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-02', actualStart: 9, actualEnd: 15 }], { '2026-11': 4 });
  await app.open();
  const calendar = page.getByRole('region', { name: '2026 年 11 月' });
  const salary = page.getByRole('region', { name: /薪資試算/ });
  expect((await salary.boundingBox())!.y).toBeGreaterThan((await calendar.boundingBox())!.y + (await calendar.boundingBox())!.height - 1);

  await page.getByRole('button', { name: '設定這個月' }).click();
  const dialog = page.getByRole('dialog', { name: '11 月薪資設定' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(900);

  await dialog.getByLabel('本薪（每月）').fill('36000');
  for (const name of ['勞保費', '健保費', '職工福利金', '勞工自提退休金']) {
    await dialog.getByRole('region', { name: '扣項' }).getByRole('button', { name, exact: true }).click();
  }
  await dialog.getByRole('region', { name: '加項' }).getByRole('button', { name: '津貼', exact: true }).click();
  await dialog.getByLabel('加項 1 的金額').fill('2400');
  await expect(dialog.getByRole('button', { name: '儲存' })).toBeInViewport(); // 內容比視窗高，儲存鈕仍然固定在畫面內
  await dialog.getByLabel('扣項 1 的金額').fill('900');
  await dialog.getByRole('button', { name: '儲存' }).click();
  // 6 小時 − 應上班 4 小時 = 加班 2 小時 → 2 × 150 × 1.34 = 402；36,000 + 402 + 2,400 − 900 − 福利金 0.5%（180）= 37,722
  await expect(page.getByTestId('net-pay')).toHaveText('NT$ 37,722');
});
