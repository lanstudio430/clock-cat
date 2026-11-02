// 把芫荽（Iansui）裁切成只含介面會用到的字，輸出到 web/public/fonts/。
// 介面文字有增減時執行 `npm run fonts`；單元測試會檢查有沒有字漏掉。
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import { collectInterfaceText } from './interface-text.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SOURCE_URL = 'https://github.com/google/fonts/raw/main/ofl/iansui/Iansui-Regular.ttf';
const cacheFile = path.join(root, '.cache', 'Iansui-Regular.ttf');
const outDir = path.join(root, 'web', 'src', 'assets', 'fonts');

if (!fs.existsSync(cacheFile)) {
  console.log('下載芫荽原始字型…');
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`下載失敗：${response.status}`);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, Buffer.from(await response.arrayBuffer()));
}

const cjk = collectInterfaceText(root);
const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const woff2 = await subsetFont(fs.readFileSync(cacheFile), ascii + cjk.join(''), { targetFormat: 'woff2' });

fs.writeFileSync(path.join(outDir, 'iansui.woff2'), woff2);
fs.writeFileSync(path.join(outDir, 'iansui-chars.txt'), cjk.join('') + '\n');
console.log(`芫荽裁切完成：${cjk.length} 個字，${(woff2.length / 1024).toFixed(1)} KB`);
