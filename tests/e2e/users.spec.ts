import type { Page } from '@playwright/test';
import type { Backend } from '../helpers/backend';
import { API_URL, expect, test } from './fixtures';

const HUA_KEY = 'h'.repeat(40);
const HUA_SHEET = 'HUA_SPREADSHEET_ID_00001';

/** 在主控試算表的「使用者」工作表加一位使用者，並給他一份空的試算表 */
function addUser(backend: Backend, name: string, key: string, id: string) {
  const spreadsheet = backend.mock.addSpreadsheet(id);
  const main = backend.mock.globals.SpreadsheetApp.getActiveSpreadsheet();
  const users = main.getSheetByName('使用者') ?? main.insertSheet('使用者');
  if (!users.rows.length) users.rows.push(['名稱', '密鑰', '試算表']);
  users.rows.push([name, key, id]);
  return spreadsheet;
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: '使用者與連線設定' });

/** 從頂列的頭像選單切換使用者 */
async function switchTo(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `切換使用者，目前是${from}` }).click();
  await page.getByRole('menu', { name: '切換使用者' }).getByRole('menuitemradio', { name: new RegExp(`^${to}`) }).click();
}

/** 從頂列的頭像選單打開管理使用者 */
async function manage(page: Page, current: string) {
  await page.getByRole('button', { name: `切換使用者，目前是${current}` }).click();
  await page.getByRole('menuitem', { name: '管理使用者' }).click();
}
const shiftRows = (spreadsheet: { sheets: Record<string, { rows: string[][] }> }) => spreadsheet.sheets['班表']?.rows.slice(1) ?? [];

async function addProfile(page: Page, url: string, key: string, name: string) {
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '用密鑰加入' }).click();
  await expect(dialog.getByLabel('Apps Script 網址')).toHaveValue(API_URL);
  await dialog.getByLabel('Apps Script 網址').fill(url);
  await dialog.getByRole('textbox', { name: '密鑰', exact: true }).fill(key);
  await dialog.getByLabel('名稱').fill(name);
  await dialog.getByRole('button', { name: '加入' }).click();
}

test('舊版的連線設定和快取，升級後變成第一位使用者「我」', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-02', plannedStart: 9, plannedEnd: 18 }]);
  await app.open();
  expect(await app.label(11, 2)).toBe('原定 09 至 18');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:profiles')!))).toEqual({
    active: 'main',
    list: [{ id: 'main', name: '我', url: API_URL, key: 'test-key', admin: true }],
  });
  // 第一位使用者沿用舊的鍵名，快取不用搬
  expect(await page.evaluate(() => localStorage.getItem('clockcat:month:2026-11') !== null)).toBe(true);
  // 只有一位使用者時，設定直接打開那一位
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  await expect(dialogOf(page).getByLabel('名稱')).toHaveValue('我');
});

test('管理員在 App 裡建立使用者，資料寫在新的試算表', async ({ app, backend, page }) => {
  backend.seed([{ date: '2026-11-02', plannedStart: 9, plannedEnd: 18 }]);
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '多位使用者' }).click();

  await dialog.getByRole('button', { name: '建立新使用者' }).click();
  await expect(dialog.getByLabel('新使用者名稱')).toBeFocused();
  await dialog.getByRole('button', { name: '建立', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('請輸入名稱');
  await dialog.getByLabel('新使用者名稱').fill('小華');
  await dialog.getByRole('button', { name: '建立', exact: true }).click();
  const created = dialog.getByRole('status');
  await expect(created).toHaveText(/已建立「小華」/);
  // 放進資料夾是預期的結果，不用特別說；密鑰也不顯示，要用時從編輯小華或「使用者」工作表拿
  await expect(created).not.toContainText('資料夾');
  await expect(created).not.toContainText(/[0-9a-f]{64}/);
  await expect(created.getByRole('link', { name: '開啟試算表' })).toHaveAttribute('href', /docs\.google\.com\/spreadsheets\/d\/CREATED_/);
  const id = Object.keys(backend.mock.spreadsheets).find((name) => name.startsWith('CREATED_'))!;
  expect(backend.mock.spreadsheets[id].title).toBe('工時貓 - 小華');

  // 小華已經加到這台裝置，不會再出現「加入」
  await expect(dialog.getByRole('button', { name: '加入小華' })).toHaveCount(0);
  await expect(dialog.getByRole('list', { name: '使用者' }).getByRole('listitem')).toHaveCount(2);

  // 切換到小華：月曆是空的，記下的時間寫到小華的試算表
  await dialog.getByRole('list', { name: '使用者' }).getByRole('button', { name: /^小華/ }).click();
  await expect(dialog).toBeHidden();
  await expect(app.toast).toContainText('換成小華了');
  await expect(app.stamp).toHaveText('已同步');
  await expect(page.getByRole('button', { name: '切換使用者，目前是小華' })).toBeVisible();
  expect(await app.label(11, 2)).toBe('');
  await app.edit(11, 3, { actual: [10, 15] });
  await expect(app.stamp).toHaveText('已同步');
  expect(shiftRows(backend.mock.spreadsheets[id])).toEqual([['2026-11-03', '', '', '10', '15', '']]);
  expect(backend.shiftRows()).toEqual([['2026-11-02', '9', '18', '', '', '']]);

  // 小華不是管理員，看不到建立使用者
  await manage(page, '小華');
  await expect(dialog.getByRole('button', { name: '用密鑰加入' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '建立新使用者' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '關閉' }).click();
  await expect(dialog).toBeHidden();

  // 從頭像選單換回自己：原本的資料都在
  await switchTo(page, '小華', '我');
  await expect(app.stamp).toHaveText('已同步');
  expect(await app.label(11, 2)).toBe('原定 09 至 18');
  expect(await app.label(11, 3)).toBe('');
});

test('貼上別人的密鑰加入使用者；各自的待同步變更不會送錯試算表', async ({ app, backend, page }) => {
  const hua = addUser(backend, '小華', HUA_KEY, HUA_SHEET);
  await app.open();

  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '多位使用者' }).click();
  await addProfile(page, API_URL, 'test-key', '重複');
  await expect(dialog.getByRole('alert')).toHaveText('這位使用者已經在這台裝置上了');
  await dialog.getByLabel('名稱').fill('');
  await dialog.getByRole('textbox', { name: '密鑰', exact: true }).fill(HUA_KEY);
  await dialog.getByRole('button', { name: '加入' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('請輸入名稱');
  await dialog.getByLabel('名稱').fill('小華');
  await dialog.getByRole('button', { name: '加入' }).click();
  await expect(dialog).toBeHidden();
  await expect(app.stamp).toHaveText('已同步');

  // 小華離線時記了一筆，接著切回自己
  app.net.offline = true;
  await app.edit(11, 4, { type: '休假' });
  await expect(app.stamp).toHaveText('離線・1 筆待同步');
  await page.getByRole('button', { name: '切換使用者，目前是小華' }).click();
  const menu = page.getByRole('menu', { name: '切換使用者' });
  await expect(menu.getByRole('menuitemradio', { name: /^小華/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: /^小華/ })).toContainText('1');
  app.net.offline = false;
  await menu.getByRole('menuitemradio', { name: /^我/ }).click();
  await expect(menu).toBeHidden();
  await expect(app.stamp).toHaveText('已同步');
  expect(backend.shiftRows()).toEqual([]);
  expect(shiftRows(hua)).toEqual([]);

  // 換回小華才送出，送到小華的試算表
  await switchTo(page, '我', '小華');
  await expect(app.stamp).toHaveText('已同步');
  expect(shiftRows(hua)).toEqual([['2026-11-04', '', '', '', '', '休假']]);
  expect(backend.shiftRows()).toEqual([]);
  expect(await app.label(11, 4)).toBe('休假');
});

test('從這台裝置移除使用者，要按兩次', async ({ app, backend, page }) => {
  addUser(backend, '小華', HUA_KEY, HUA_SHEET);
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '多位使用者' }).click();
  await addProfile(page, API_URL, HUA_KEY, '小華');
  await expect(app.stamp).toHaveText('已同步');

  await manage(page, '小華');
  await dialog.getByRole('button', { name: '編輯小華' }).click();
  await dialog.getByRole('button', { name: '從這台裝置移除' }).click();
  await dialog.getByRole('button', { name: '再按一次，從這台裝置移除小華' }).click();
  // 移除的是目前的使用者：換回剩下的那一位，頂列也變回齒輪
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '使用者與連線設定', exact: true })).toBeVisible();
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:profiles')!));
  expect(profiles.list.map((profile: { name: string }) => profile.name)).toEqual(['我']);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('clockcat:u:')))).toEqual([]);
});

test('使用者的試算表打不開時說明原因', async ({ app, backend, page }) => {
  addUser(backend, '小華', HUA_KEY, HUA_SHEET);
  delete backend.mock.spreadsheets[HUA_SHEET];
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  await dialogOf(page).getByRole('button', { name: '多位使用者' }).click();
  await addProfile(page, API_URL, HUA_KEY, '小華');
  await expect(page.getByRole('alert').filter({ hasText: '連線設定有問題' })).toContainText('打不開這位使用者的試算表');
});

test('後端還沒更新時，提示要重新部署才能建立使用者', async ({ app, page }) => {
  app.net.legacyBackend = true;
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '多位使用者' }).click();
  await expect(dialog).toContainText('後端還沒更新到多使用者版本');
  await expect(dialog.getByRole('button', { name: '建立新使用者' })).toHaveCount(0);
});

test('試算表裡有、這台裝置還沒有的使用者，直接在清單裡加入', async ({ app, backend, page }) => {
  addUser(backend, '小華', HUA_KEY, HUA_SHEET);
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: '多位使用者' }).click();
  const people = dialog.getByRole('list', { name: '使用者' });
  await expect(people.getByRole('listitem').filter({ hasText: '小華' })).toContainText('不在這台裝置');
  await people.getByRole('button', { name: '加入小華' }).click();
  await expect(people.getByRole('button', { name: '加入小華' })).toHaveCount(0);
  await expect(people.getByRole('button', { name: '編輯小華' })).toBeVisible();
  // 加入後不會自動切換，按一下名字才切過去
  await people.getByRole('button', { name: /^小華/ }).click();
  await expect(app.stamp).toHaveText('已同步');
  await expect(page.getByRole('button', { name: '切換使用者，目前是小華' })).toBeVisible();
});

test('頭像選單：點外面或按 Esc 會關上', async ({ app, backend, page }) => {
  addUser(backend, '小華', HUA_KEY, HUA_SHEET);
  await app.open();
  await page.getByRole('button', { name: '使用者與連線設定' }).click();
  await dialogOf(page).getByRole('button', { name: '多位使用者' }).click();
  await dialogOf(page).getByRole('button', { name: '加入小華' }).click();
  await dialogOf(page).getByRole('button', { name: '關閉' }).click();

  const avatar = page.getByRole('button', { name: '切換使用者，目前是我' });
  const menu = page.getByRole('menu', { name: '切換使用者' });
  await avatar.click();
  await expect(avatar).toHaveAttribute('aria-expanded', 'true');
  // 打開時焦點在目前的使用者，上下鍵移動
  await expect(menu.getByRole('menuitemradio', { name: /^我/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: /^小華/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(avatar).toBeFocused();

  await avatar.click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).toBeHidden();
});
