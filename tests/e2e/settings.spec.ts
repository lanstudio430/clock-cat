import { expect, test } from './fixtures';

test.describe('第一次使用', () => {
  test.use({ settings: null });

  test('先填連線設定，檢查網址與密鑰', async ({ app, page }) => {
    await page.goto('./');
    const dialog = page.getByRole('dialog', { name: '連線設定' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('嗨！我是工時貓');
    const url = dialog.getByLabel('Apps Script 網址');
    const key = dialog.getByRole('textbox', { name: '密鑰', exact: true });
    const submit = dialog.getByRole('button', { name: '開始使用' });
    const error = dialog.getByRole('alert');

    await url.fill('http://script.google.com/macros/s/X/exec');
    await key.fill('k');
    await submit.click();
    await expect(error).toHaveText('網址需要是 https://script.google.com/… 結尾為 /exec 的部署網址');

    await url.fill('https://script.google.com/macros/s/X/dev');
    await submit.click();
    await expect(error).toHaveText('要用結尾是 /exec 的部署網址，不是 /dev');

    await url.fill('https://script.google.com/macros/s/X/exec');
    await key.fill('   ');
    await submit.click();
    await expect(error).toHaveText('請輸入密鑰');
    expect(await page.evaluate(() => localStorage.getItem('clockcat:profiles'))).toBeNull();

    // 密鑰可以切換顯示
    await expect(key).toHaveAttribute('type', 'password');
    await dialog.getByRole('button', { name: '顯示密鑰' }).click();
    await expect(dialog.getByRole('textbox', { name: '密鑰', exact: true })).toHaveAttribute('type', 'text');

    await dialog.getByRole('textbox', { name: '密鑰', exact: true }).fill(' test-key ');
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(app.stamp).toHaveText('已同步');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:profiles')!))).toEqual({
      active: 'main',
      list: [{ id: 'main', name: '我', url: 'https://script.google.com/macros/s/X/exec', key: 'test-key', admin: true }],
    });
    await expect(app.day(11, 2)).toBeEnabled();
  });

  test('關掉設定也能之後再打開', async ({ app, page }) => {
    await page.goto('./');
    await page.keyboard.press('Escape');
    await expect(app.stamp).toHaveText('尚未設定連線');
    await expect(app.day(11, 2)).toBeDisabled();
    await app.stamp.click();
    await expect(page.getByRole('dialog', { name: '連線設定' })).toBeVisible();
  });
});

test.describe('密鑰錯誤', () => {
  test.use({ settings: { url: 'https://script.google.com/macros/s/TEST/exec', key: 'nope' } });

  test('說明原因，改對密鑰就恢復', async ({ app, page }) => {
    await page.goto('./');
    const card = page.getByRole('alert').filter({ hasText: '連線設定有問題' });
    await expect(card).toContainText('密鑰不正確');
    // 錯誤卡取代了本月卡，所以從錯誤卡打開設定
    await card.getByRole('button', { name: '設定' }).click();
    const dialog = page.getByRole('dialog', { name: '連線設定' });
    await expect(dialog).toContainText('目前的問題：密鑰不正確');
    await dialog.getByRole('textbox', { name: '密鑰', exact: true }).fill('test-key');
    await dialog.getByRole('button', { name: '儲存' }).click();
    await expect(app.stamp).toHaveText('已同步');
    await expect(card).toHaveCount(0);
  });
});

test('部署權限不是「任何人」時給出提示', async ({ app, page }) => {
  app.net.notDeployed = true;
  await page.goto('./');
  const card = page.getByRole('alert').filter({ hasText: '連線設定有問題' });
  await expect(card).toContainText('存取權限是「任何人」');
  await expect(card.getByRole('button', { name: '設定' })).toBeVisible();
});
