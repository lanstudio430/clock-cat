// 收集介面上可能出現的中文字：前端原始碼、HTML 與 Apps Script 回傳的錯誤訊息。
import fs from 'node:fs';
import path from 'node:path';

const SOURCES = ['web/index.html', 'web/src', 'apps-script/Code.gs'];
const EXTENSIONS = new Set(['.html', '.svelte', '.ts', '.gs', '.js']);

function walk(target, files) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) walk(path.join(target, name), files);
  } else if (EXTENSIONS.has(path.extname(target))) {
    files.push(target);
  }
  return files;
}

// 整行都是註解的不算，註解不會出現在畫面上；所以中文註解一律寫在獨立的一行
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|<!--)/;

/** 回傳排序過、不重複的中日韓字元與全形標點（U+2E80 以上）。 */
export function collectInterfaceText(root) {
  const chars = new Set();
  for (const source of SOURCES) {
    for (const file of walk(path.join(root, source), [])) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (COMMENT_LINE.test(line)) continue;
        for (const char of line) {
          if (char.codePointAt(0) >= 0x2e80) chars.add(char);
        }
      }
    }
  }
  return [...chars].sort();
}
