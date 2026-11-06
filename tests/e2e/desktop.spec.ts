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

test.describe('桌面版月份列', () => {
  const strip = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: '月份' });
  const scrollLeft = (page: import('@playwright/test').Page) => strip(page).evaluate((node) => node.scrollLeft);

  test('左右箭頭一次換一個月，跨年也可以', async ({ app, page }) => {
    await app.open();
    await page.getByRole('button', { name: '上個月' }).click();
    await expect(page.getByRole('button', { name: '2026 年 10 月' })).toHaveAttribute('aria-current', 'date');
    for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '下個月' }).click();
    await expect(page.getByRole('button', { name: '2027 年 8 月' })).toHaveAttribute('aria-current', 'date');
    await expect(page.getByLabel('年份')).toHaveValue('2027');
  });

  test('滑鼠滾輪在月份列上左右捲動，可以點到前面的月份', async ({ app, page }) => {
    await app.open();
    const far = page.getByRole('button', { name: '2025 年 11 月' }); // 目前選中的往前 12 個月，一開始在畫面外
    await expect(far).not.toBeInViewport();

    const box = (await strip(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await scrollLeft(page);
    await page.mouse.wheel(0, -3000); // 一般滾輪是上下，這裡要變成往左
    await expect.poll(() => scrollLeft(page)).toBeLessThan(before);
    await expect(far).toBeInViewport();
    await far.click();
    await expect(page.getByLabel('年份')).toHaveValue('2025');
    await expect(page.getByRole('button', { name: '2025 年 11 月' })).toHaveAttribute('aria-current', 'date');
  });

  test('按住滑鼠拖曳也能捲動，拖完不會誤點到月份', async ({ app, page }) => {
    await app.open();
    const box = (await strip(page).boundingBox())!;
    const y = box.y + box.height / 2;
    const before = await scrollLeft(page);
    await page.mouse.move(box.x + 100, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => scrollLeft(page)).toBeLessThan(before); // 往右拖 = 內容往右 = 看到前面的月份
    await expect(page.getByRole('button', { name: '2026 年 11 月' })).toHaveAttribute('aria-current', 'date'); // 沒有因為放開滑鼠換月份

    // 沒有拖曳的一般點擊照常運作
    await page.getByRole('button', { name: '2026 年 12 月' }).click();
    await expect(page.getByRole('button', { name: '2026 年 12 月' })).toHaveAttribute('aria-current', 'date');
  });
});

test('桌面版：點月份後，選中的月份一直留在月份列的可見範圍內', async ({ app, page }) => {
  await app.open();
  const strip = page.getByRole('navigation', { name: '月份' });
  const visible = async (name: string) => {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    const bar = (await strip.boundingBox())!;
    return box.x >= bar.x - 1 && box.x + box.width <= bar.x + bar.width + 1;
  };
  const centerOffset = async (name: string) => {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    const bar = (await strip.boundingBox())!;
    return box.x + box.width / 2 - (bar.x + bar.width / 2);
  };
  for (const [name, selected] of [['2027 年 3 月', '2027 年 3 月'], ['2026 年 12 月', '2026 年 12 月'], ['2027 年 1 月', '2027 年 1 月']]) {
    await page.getByRole('button', { name }).click();
    await expect(page.getByRole('button', { name: selected })).toHaveAttribute('aria-current', 'date');
    await page.waitForTimeout(700); // 等平滑捲動結束
    expect(await visible(selected)).toBe(true);
    expect(Math.abs(await centerOffset(selected))).toBeLessThan(30); // 而且捲到月份列的正中間
  }
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: '上個月' }).click();
    await page.waitForTimeout(500);
  }
  expect(await visible('2026 年 7 月')).toBe(true);
});
