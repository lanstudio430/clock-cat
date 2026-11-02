<script lang="ts">
  import { app } from '../lib/app-state.svelte';
  import type { IconName } from '../lib/icons';
  import Icon from './Icon.svelte';

  const ICONS: Record<string, IconName> = { ok: 'check', sync: 'circleNotch', warn: 'cloudBolt', bad: 'key' };
  const stamp = $derived(app.stamp);

  function act() {
    if (stamp.action === 'retry') app.retry();
    else if (stamp.action === 'settings') app.openSettings();
  }
</script>

<!-- 狀態改變時重新建立元素，印章會輕輕晃一下 -->
{#key `${stamp.tone}${stamp.text}`}
  {#if stamp.action}
    <button type="button" class="stamp {stamp.tone}" data-testid="stamp" title="點一下{stamp.action === 'retry' ? '重試' : '看連線設定'}" onclick={act}>
      <Icon name={ICONS[stamp.tone]} />{stamp.text}
    </button>
  {:else}
    <span class="stamp {stamp.tone}" data-testid="stamp" role="status">
      <Icon name={ICONS[stamp.tone]} spin={stamp.tone === 'sync'} />{stamp.text}
    </span>
  {/if}
{/key}

<style>
  .stamp {
    position: absolute;
    right: 12px;
    top: -14px;
    z-index: 3;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    min-height: 30px;
    padding: 2px 10px;
    border: 2px dashed currentColor;
    border-radius: 10px;
    background: var(--card);
    font-size: 13px;
    transform: rotate(6deg);
    animation: wobble 0.45s ease-out;
  }
  button.stamp {
    min-height: 34px;
    cursor: pointer;
  }
  .ok {
    color: var(--green-text);
  }
  .sync {
    color: var(--blue-text);
  }
  .warn {
    color: var(--brown-text);
    background: #fff3e2;
  }
  .bad {
    color: var(--time);
    background: var(--holiday);
  }
  @keyframes wobble {
    0% {
      transform: rotate(6deg) scale(1.15);
    }
    40% {
      transform: rotate(-4deg) scale(1);
    }
    70% {
      transform: rotate(9deg);
    }
    100% {
      transform: rotate(6deg);
    }
  }
</style>
