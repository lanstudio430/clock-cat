import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { createBackend, TEST_KEY, type Backend } from '../helpers/backend';

export { expect };

export const API_URL = 'https://script.google.com/macros/s/TEST/exec';
// 固定「今天」是 2026-11-02（星期一），測試不受執行日期影響
export const TODAY = new Date('2026-11-02T10:00:00+08:00');

/** 控制假的網路：離線、延遲、竄改請求，並記錄送出的內容（不含密鑰）。 */
export interface Net {
  offline: boolean;
  delays: number[];
  requests: Record<string, unknown>[];
  tamper: ((body: Record<string, any>) => void) | null;
  notDeployed: boolean;
  /** 模擬還沒重新部署的舊後端：不認得薪資設定的動作 */
  legacyBackend: boolean;
}

/** 舊後端不認得的動作：薪資設定與多使用者 */
const LEGACY_UNKNOWN = ['getPayData', 'savePayCatalog', 'savePayMonth', 'getAccount', 'listUsers', 'createUser'];

type Pair =[number, number | null] | null;
export interface EditOptions {
  planned?: Pair;
  actual?: Pair;
  type?: '' | '例假' | '休假' | '國定假日';
  save?: boolean;
}

const MINUTE_LABELS: Record<number, string> = { 0: '0', 0.25: '.25', 0.5: '.5', 0.75: '.75' };
const pad = (n: number) => String(n).padStart(2, '0');

export class CalendarPage {
  constructor(
    readonly page: Page,
    readonly net: Net,
    readonly backend: Backend,
  ) {}

  get editor(): Locator {
    return this.page.locator('[aria-labelledby="editor-title"]');
  }
  get stamp() {
    return this.page.getByTestId('stamp');
  }
  get required() {
    return this.page.getByLabel('應上班時數');
  }
  get grandTotal() {
    return this.page.getByTestId('grand-total');
  }
  get overtime() {
    return this.page.getByTestId('overtime');
  }
  get toast() {
    return this.page.locator('[aria-live="polite"]');
  }

  async open() {
    await this.page.goto('./');
    await expect(this.stamp).toHaveText('已同步');
  }

  day(month: number, date: number) {
    return this.page.getByRole('button', { name: new RegExp(`^${month}月${date}日(，|$)`) });
  }

  /** 日期格子說明裡日期之後的部分，例如「實際 9.25 至 21.75，國定假日」。 */
  async label(month: number, date: number) {
    const name = (await this.day(month, date).getAttribute('aria-label')) ?? '';
    return name.split('，').slice(1).join('，');
  }

  weekTotals() {
    return this.page.getByTestId('week-total').allTextContents();
  }

  async goToMonth(year: number, month: number) {
    if ((await this.page.getByLabel('年份').inputValue()) !== String(year)) {
      await this.page.getByLabel('年份').selectOption(String(year));
    }
    await this.page.getByRole('button', { name: `${year} 年 ${month} 月` }).click();
  }

  async pick(value: number) {
    const hour = Math.floor(value);
    await this.editor.getByRole('radiogroup', { name: /小時/ }).getByRole('radio', { name: pad(hour), exact: true }).click();
    await this.editor.getByRole('radiogroup', { name: /分鐘/ }).getByRole('radio', { name: MINUTE_LABELS[value - hour], exact: true }).click();
  }

  /** 切到分頁、清除後重新選；選完上班的分鐘會自動跳到下班。 */
  async setPair(tab: '原定' | '實際', pair: Pair) {
    await this.editor.getByRole('button', { name: new RegExp(`^${tab}`) }).click();
    await this.editor.getByRole('button', { name: '清除這組' }).click();
    if (!pair) return;
    await this.pick(pair[0]);
    if (pair[1] !== null) await this.pick(pair[1]);
  }

  async edit(month: number, date: number, { planned, actual, type, save = true }: EditOptions) {
    await this.day(month, date).click();
    await expect(this.editor).toBeVisible();
    if (planned !== undefined) await this.setPair('原定', planned);
    if (actual !== undefined) await this.setPair('實際', actual);
    if (type !== undefined) {
      await this.editor.getByRole('radiogroup', { name: '假別' }).getByRole('radio', { name: type || '無', exact: true }).click();
    }
    if (save) await this.editor.getByRole('button', { name: '儲存' }).click();
  }

  async setRequired(value: string) {
    await this.required.fill(value);
    await this.required.press('Tab');
  }

  queue() {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('clockcat:queue') ?? '[]'));
  }
}

type Fixtures = {
  settings: { url: string; key: string } | null;
  backend: Backend;
  net: Net;
  app: CalendarPage;
};

export const test = base.extend<Fixtures>({
  settings: [{ url: API_URL, key: TEST_KEY }, { option: true }],

  backend: async ({}, use) => {
    await use(createBackend());
  },

  net: async ({ page, backend }, use) => {
    const net: Net = { offline: false, delays: [], requests: [], tamper: null, notDeployed: false, legacyBackend: false };
    await page.route('https://script.google.com/**', async (route) => {
      const delay = net.delays.length ? net.delays.shift()! : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        if (net.offline) return await route.abort('internetdisconnected');
        const body = JSON.parse(route.request().postData() ?? '{}');
        const { key, ...logged } = body;
        net.requests.push(logged);
        if (net.tamper && body.action === 'saveEntry') {
          net.tamper(body);
          net.tamper = null;
        }
        const headers = { 'access-control-allow-origin': '*' };
        if (net.legacyBackend && LEGACY_UNKNOWN.includes(body.action)) {
          const unsupported = { ok: false, code: 'bad_request', error: `不支援的操作：${body.action}` };
          return await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(unsupported) });
        }
        if (net.notDeployed) {
          return await route.fulfill({ status: 200, contentType: 'text/html', headers, body: '<html>Sign in</html>' });
        }
        await route.fulfill({ status: 200, contentType: 'application/json', headers, body: backend.handle(JSON.stringify(body)) });
      } catch {
        // 頁面已關閉或重新整理時，未完成的請求直接放掉
      }
    });
    await use(net);
  },

  app: async ({ page, net, backend, settings }, use) => {
    await page.clock.setFixedTime(TODAY);
    if (settings) {
      await page.addInitScript((value) => {
        if (!localStorage.getItem('clockcat:settings')) localStorage.setItem('clockcat:settings', JSON.stringify(value));
      }, settings);
    }
    await use(new CalendarPage(page, net, backend));
  },
});
