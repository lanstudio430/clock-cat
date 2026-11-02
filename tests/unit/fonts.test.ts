import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { collectInterfaceText } from '../../scripts/interface-text.mjs';

const root = path.resolve(import.meta.dirname, '../..');

it('裁切後的芫荽包含介面上所有中文字（漏了就執行 npm run fonts）', () => {
  const included = new Set(fs.readFileSync(path.join(root, 'web/src/assets/fonts/iansui-chars.txt'), 'utf8').trim());
  const missing = collectInterfaceText(root).filter((char: string) => !included.has(char));
  expect(missing.join('')).toBe('');
});
