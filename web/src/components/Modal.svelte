<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../lib/icons';
  import Icon from './Icon.svelte';

  let { open, title, titleId, icon, onclose, onsubmit, children, footer }: {
    open: boolean;
    title: string;
    titleId: string;
    icon: IconName;
    onclose: () => void;
    onsubmit: () => void;
    children: Snippet;
    footer: Snippet;
  } = $props();

  let dialog: HTMLDialogElement;

  // 用原生 dialog：焦點鎖定、Esc 關閉與疊在別的視窗上面，都由瀏覽器處理
  $effect(() => {
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} {onclose}>
  <form
    class="sticker"
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      onsubmit();
    }}
  >
    <span class="tape" style="left:18px;top:-12px;transform:rotate(-6deg)"></span>
    <header>
      <h2 id={titleId}><Icon name={icon} />{title}</h2>
      <button type="button" class="close press" aria-label="關閉" onclick={onclose}><Icon name="xmark" /></button>
    </header>
    <div class="body">{@render children()}</div>
    <footer>{@render footer()}</footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100% - 20px));
    max-height: calc(100dvh - 20px);
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    color: inherit;
  }
  dialog::backdrop {
    background: rgba(69, 43, 51, 0.45);
  }
  form {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 20px);
    background-color: var(--paper);
    background-image: radial-gradient(var(--dot) 1.3px, transparent 1.5px);
    background-size: 18px 18px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 16px 8px;
  }
  h2 {
    margin: 0;
    font-size: 23px;
    font-weight: 400;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  h2 :global(.icon) {
    color: var(--coral);
  }
  .close {
    width: 44px;
    height: 44px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: grid;
    place-items: center;
    font-size: 18px;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 16px 16px;
    display: grid;
    gap: 18px;
    align-content: start;
  }
  footer {
    padding: 10px 16px calc(14px + var(--safe-bottom));
    border-top: 2px solid var(--ink);
    background: var(--paper);
    border-radius: 0 0 17px 17px;
  }
</style>
