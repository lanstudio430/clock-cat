import { expect, test } from './fixtures';

test('第一次載入用一個請求抓前後三個月，請求紀錄裡沒有密鑰', async ({ app, net }) => {
  await app.open();
  expect(net.requests[0]).toEqual({ action: 'getMonths', months: ['2026-10', '2026-11', '2026-12'] });
  expect('key' in net.requests[0]).toBe(false);
});

test('儲存先更新畫面，背景才送到試算表', async ({ app, backend }) => {
  await app.open();
  app.net.delays.push(400);
  await app.edit(11, 13, { actual: [9, 12] });
  await expect(app.editor).toBeHidden();
  expect(await app.label(11, 13)).toBe('實際 09 至 12');
  await expect(app.toast).toContainText('記下了！11月13日 3h');
  await expect(app.stamp).toHaveText('同步中');
  expect(backend.shiftRows()).toEqual([]);

  await expect(app.stamp).toHaveText('已同步');
  expect(backend.shiftRows()).toEqual([['2026-11-13', '', '', '9', '12', '']]);
  expect(await app.queue()).toEqual([]);
  // 成功提示幾秒後自動消失
  await expect(app.toast).toBeEmpty({ timeout: 6000 });
});

test('離線時變更排隊，恢復連線後依序送出', async ({ app, backend }) => {
  backend.seed([{ date: '2026-11-13', actualStart: 9, actualEnd: 12 }]);
  await app.open();
  app.net.offline = true;

  await app.edit(11, 14, { actual: [9, 10] });
  await app.edit(11, 14, { actual: [9, 11] });
  await app.day(11, 13).click();
  await app.editor.getByRole('button', { name: '刪除' }).click();

  await expect(app.stamp).toHaveText('離線・3 筆待同步');
  expect((await app.queue()).length).toBe(3);
  expect(await app.label(11, 14)).toBe('實際 09 至 11');
  expect(await app.label(11, 13)).toBe('');
  expect(backend.shiftRows()).toEqual([['2026-11-13', '', '', '9', '12', '']]);

  app.net.offline = false;
  await app.stamp.click();
  await expect(app.stamp).toHaveText('已同步');
  expect(backend.shiftRows()).toEqual([['2026-11-14', '', '', '9', '11', '']]);
  expect(await app.queue()).toEqual([]);
});

test('試算表拒絕的變更會被丟掉，畫面改回試算表的內容', async ({ app, backend }) => {
  await app.open();
  app.net.tamper = (body) => {
    body.entry.dayType = '壞假';
  };
  await app.edit(11, 11, { actual: [9, 18] });

  const alert = app.toast.getByRole('alert');
  await expect(alert).toContainText('11月11日沒存到：假別不正確');
  await expect.poll(() => app.label(11, 11)).toBe('');
  expect(backend.shiftRows()).toEqual([]);
  expect(await app.queue()).toEqual([]);

  // 錯誤提示不會被成功提示蓋掉，要按「知道了」
  await app.edit(11, 12, { type: '休假' });
  await expect(alert).toContainText('11月11日沒存到');
  await alert.getByRole('button', { name: '知道了' }).click();
  await expect(app.toast).toBeEmpty();
});

test('快速切換月份時，慢回來的舊結果不會蓋掉新的月份', async ({ app, page }) => {
  await app.open();
  app.net.delays.push(500, 10);
  await page.getByLabel('年份').selectOption('2030');
  await page.getByRole('button', { name: '2030 年 3 月' }).click();

  await expect(page.getByRole('button', { name: '2030 年 3 月' })).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('button', { name: /^3月\d+日/ })).toHaveCount(31);
  await expect(page.getByRole('button', { name: /^3月1日/ })).toBeEnabled();
  await page.waitForTimeout(700);
  await expect(page.getByRole('button', { name: '2030 年 3 月' })).toHaveAttribute('aria-current', 'date');
  await expect(app.stamp).toHaveText('已同步');
  // 慢回來的結果仍然存進快取，之後切過去不用等
  expect(await page.evaluate(() => localStorage.getItem('clockcat:month:2030-11') !== null)).toBe(true);
});

test('沒看過的月份連不上時顯示錯誤卡，可以重試', async ({ app, page }) => {
  await app.open();
  app.net.offline = true;
  await page.getByLabel('年份').selectOption('2028');

  const card = page.getByRole('alert').filter({ hasText: '連不上 Apps Script' });
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: /^11月1日/ })).toBeDisabled();
  await expect(page.getByTestId('week-total').first()).toHaveText('–');

  app.net.offline = false;
  await card.getByRole('button', { name: '重試' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^11月1日/ })).toBeEnabled();
  await expect(app.required).toBeEnabled();
});

test('看過的月份離線也能看，並標示是上次的資料', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-02', actualStart: 9.5, actualEnd: 21.5 }]);
  await app.open();
  await app.goToMonth(2026, 12);
  await expect(app.stamp).toHaveText('已同步');

  app.net.offline = true;
  await app.goToMonth(2026, 11);
  expect(await app.label(11, 2)).toBe('實際 9.5 至 21.5');
  await expect(app.stamp).toHaveText('顯示上次的資料');
  await expect(app.day(11, 2)).toBeEnabled();

  app.net.offline = false;
  await app.stamp.click();
  await expect(app.stamp).toHaveText('已同步');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('重新開啟 App 後，快取與待同步的變更都還在', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-02', plannedStart: 9, plannedEnd: 18 }]);
  await app.open();
  app.net.offline = true;
  await app.edit(11, 3, { actual: [10, 14] });
  await expect(app.stamp).toHaveText('離線・1 筆待同步');

  await page.reload();
  await expect(app.day(11, 2)).toBeEnabled();
  expect(await app.label(11, 2)).toBe('原定 09 至 18');
  expect(await app.label(11, 3)).toBe('實際 10 至 14');
  await expect(app.stamp).toHaveText('離線・1 筆待同步');

  app.net.offline = false;
  await app.stamp.click();
  await expect(app.stamp).toHaveText('已同步');
  expect(backend.shiftRows().map((row) => row[0])).toEqual(['2026-11-02', '2026-11-03']);
});

test('換成另一份試算表時，清掉沒送出的變更', async ({ app, backend, page }) => {
  await app.open();
  app.net.offline = true;
  await app.setRequired('99');
  await expect(app.stamp).toHaveText('離線・1 筆待同步');
  app.net.offline = false;

  await page.getByRole('button', { name: '連線設定' }).click();
  const dialog = page.getByRole('dialog', { name: '連線設定' });
  await expect(dialog.getByRole('textbox').first()).toHaveValue('https://script.google.com/macros/s/TEST/exec');
  await dialog.getByRole('textbox').first().fill('https://script.google.com/macros/s/OTHER/exec');
  await dialog.getByRole('button', { name: '儲存' }).click();

  await expect(dialog).toBeHidden();
  await expect(app.stamp).toHaveText('已同步');
  expect(await app.queue()).toEqual([]);
  expect(backend.monthRows()).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:settings')!))).toEqual({
    url: 'https://script.google.com/macros/s/OTHER/exec',
    key: 'test-key',
  });
});

test.describe('離線外殼', () => {
  test.use({ serviceWorkers: 'allow' });

  test('開過一次之後，完全斷網也能打開並顯示快取', async ({ app, backend, page, context }) => {
    backend.seed([{ date: '2026-11-02', plannedStart: 9, plannedEnd: 18 }]);
    await app.open();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Playwright 攔截請求時導覽會繞過 Service Worker，所以先取消攔截，讓瀏覽器真的斷網
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.setOffline(true);
    await page.reload();
    await expect(app.day(11, 2)).toBeEnabled();
    expect(await app.label(11, 2)).toBe('原定 09 至 18');
    await expect(app.stamp).toHaveText('顯示上次的資料');
    await context.setOffline(false);
  });
});
