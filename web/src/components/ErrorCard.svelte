<script lang="ts">
  import mascot from '../assets/mascot.webp';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';

  const config = $derived(app.loadError?.kind === 'config');
</script>

<!-- 這個月沒有快取又載入失敗時，取代本月卡 -->
<section class="card sticker" role="alert">
  <span class="tape sky" style="left:20px;top:-12px;transform:rotate(-5deg)"></span>
  <div class="cat" style:background-image="url({mascot})" aria-hidden="true"><Icon name="droplet" /></div>
  <div>
    <h2>{config ? '連線設定有問題' : '連不上 Apps Script'}</h2>
    <p>{app.loadError?.message}。看過的月份離線也能看。</p>
    <div class="buttons">
      <button type="button" class="press" class:primary={!config} onclick={() => app.retry()}><Icon name="rotateRight" />重試</button>
      <button type="button" class="press" class:primary={config} onclick={() => app.openSettings()}><Icon name="gear" />設定</button>
    </div>
  </div>
</section>

<style>
  .card {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px 14px;
  }
  .cat {
    position: relative;
    flex: none;
    width: 76px;
    height: 80px;
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 76px auto;
  }
  .cat :global(.icon) {
    position: absolute;
    right: -6px;
    top: 0;
    font-size: 20px;
    color: var(--blue-text);
    transform: rotate(15deg);
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 400;
  }
  p {
    margin: 4px 0 10px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--pencil);
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  button {
    height: 44px;
    padding: 0 14px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 15px;
  }
  .primary {
    background: var(--sky);
  }
</style>
