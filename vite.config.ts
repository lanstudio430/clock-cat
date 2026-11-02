import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/service-worker.ts';

// 原始碼在 web/，建置結果輸出到 docs/ 給 GitHub Pages 發布
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [svelte(), serviceWorker()],
  build: {
    outDir: '../docs',
    emptyOutDir: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
