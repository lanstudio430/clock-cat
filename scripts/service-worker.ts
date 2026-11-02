// 建置時產生 sw.js：預先快取這次建置的所有檔案，版本號跟著內容變，舊快取會自動清掉。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const SKIP = new Set(['.nojekyll', 'sw.js']);

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

export function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'clock-cat-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const publicFiles = listFiles(publicDir).filter((file) => !SKIP.has(file) && !file.endsWith('.txt'));
      const files = [...Object.keys(bundle), ...publicFiles].filter((file) => !SKIP.has(file)).sort();

      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file);
        const asset = bundle[file];
        if (asset?.type === 'asset') hash.update(asset.source);
        else if (asset?.type === 'chunk') hash.update(asset.code);
        else hash.update(fs.readFileSync(path.join(publicDir, file)));
      }
      const version = hash.digest('hex').slice(0, 12);

      const template = fs.readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const source = template
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify(['./', ...files], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
