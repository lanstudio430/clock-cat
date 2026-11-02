import { mount } from 'svelte';
import App from './App.svelte';
import './styles/global.css';

mount(App, { target: document.getElementById('app')! });

// 離線外殼只在正式版啟用；開發時每次都拿最新的檔案
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
