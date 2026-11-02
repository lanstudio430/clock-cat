<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';
</script>

<!-- 提示貼紙：成功的幾秒後自動消失；錯誤的要按「知道了」 -->
<div class="region" aria-live="polite">
  {#if app.toast}
    {#key app.toast.id}
      <div class="toast {app.toast.tone}" role={app.toast.tone === 'bad' ? 'alert' : 'status'} in:fly={{ y: 30, duration: 220 }} out:fade={{ duration: 150 }}>
        <Icon name={app.toast.tone === 'bad' ? 'triangleExclamation' : 'paw'} />
        <span class="text">{app.toast.text}</span>
        {#if app.toast.tone === 'bad'}
          <button type="button" onclick={() => app.dismissToast()}>知道了</button>
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .region {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(20px + var(--safe-bottom));
    /* 放在編輯面板（20、21）下面，才不會擋住面板裡的按鈕 */
    z-index: 15;
    display: flex;
    justify-content: center;
    padding: 0 16px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    max-width: 480px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    box-shadow: var(--shadow);
    font-size: 16px;
    transform: rotate(-1.5deg);
  }
  .ok {
    background: var(--butter);
  }
  .ok :global(.icon) {
    color: var(--coral);
  }
  .bad {
    background: var(--holiday);
  }
  .bad :global(.icon) {
    color: var(--time);
  }
  .text {
    flex: 1 1 auto;
  }
  button {
    margin-left: auto;
    min-height: 36px;
    padding: 0 12px;
    border: 2px solid var(--ink);
    border-radius: 10px;
    background: var(--card);
    font-size: 14px;
  }
</style>
