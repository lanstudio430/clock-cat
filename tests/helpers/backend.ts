// 在 Node 裡執行真正的 apps-script/Code.gs，搭配記憶體裡的試算表。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createMock } from './apps-script-mock';

const CODE = fs.readFileSync(path.resolve(import.meta.dirname, '../../apps-script/Code.gs'), 'utf8');
export const TEST_KEY = 'test-key';

export interface EntryRow {
  date: string;
  plannedStart?: number | null;
  plannedEnd?: number | null;
  actualStart?: number | null;
  actualEnd?: number | null;
  dayType?: string;
}

export function createBackend({ key = TEST_KEY }: { key?: string | null } = {}) {
  const mock = createMock();
  const context = vm.createContext({ ...mock.globals, console: { log() {}, error() {} }, crypto: globalThis.crypto });
  vm.runInContext(CODE, context);
  if (key) mock.props.API_KEY = key;

  // 經過 JSON 轉換，去掉 vm 裡的原型，方便比對
  const plain = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

  return {
    mock,
    context,
    /** 模擬一次 doPost，回傳 Apps Script 會送出的 JSON 文字。 */
    handle(body: string): string {
      return context.doPost({ postData: { contents: body } }).getContent();
    },
    call<T = unknown>(name: string, ...args: unknown[]): T {
      return plain(context[name](...args));
    },
    seed(entries: EntryRow[], required: Record<string, number> = {}) {
      for (const entry of entries) {
        context.saveEntry({ plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, dayType: '', ...entry });
      }
      for (const [month, hours] of Object.entries(required)) context.saveRequiredHours(month, hours);
    },
    shiftRows: () => (mock.sheets['班表']?.rows.slice(1) ?? []).map((row) => [...row]),
    monthRows: () => (mock.sheets['月設定']?.rows.slice(1) ?? []).map((row) => [...row]),
  };
}

export type Backend = ReturnType<typeof createBackend>;
