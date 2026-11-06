<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';

  // 頂列的頭像：點開是切換使用者的小選單，不用打開設定再往下找
  let open = $state(false);
  let root: HTMLDivElement;
  let menu = $state<HTMLDivElement>();

  const name = $derived(app.profile?.name ?? '');

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }

  function close(focusButton = false) {
    open = false;
    if (focusButton) root.querySelector<HTMLElement>('.who')?.focus();
  }

  function pick(id: string) {
    close();
    if (id !== app.profileId) app.switchProfile(id);
  }

  function manage() {
    close();
    app.openSettings();
  }

  // 點選單外面或按 Esc 就關掉；上下鍵在項目間移動
  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      event.preventDefault();
      next?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keys);
    };
  });
</script>

<div class="user" bind:this={root}>
  <button
    type="button"
    class="who press"
    aria-label="切換使用者，目前是{name}"
    aria-haspopup="menu"
    aria-expanded={open}
    title="目前是{name}"
    onclick={toggle}
  >
    {name.slice(0, 1)}
  </button>

  {#if open}
    <div class="menu sticker" role="menu" aria-label="切換使用者" bind:this={menu}>
      {#each app.profiles as profile (profile.id)}
        {@const pending = app.pendingCount(profile.id)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={profile.id === app.profileId}
          class="item"
          onclick={() => pick(profile.id)}
        >
          <span class="avatar" aria-hidden="true">{profile.name.slice(0, 1)}</span>
          <span class="name">{profile.name}</span>
          {#if pending}<span class="pending" title="{pending} 筆待同步">{pending}</span>{/if}
          {#if profile.id === app.profileId}<Icon name="check" />{/if}
        </button>
      {/each}
      <hr />
      <button type="button" role="menuitem" class="item manage" onclick={manage}>
        <Icon name="gear" />管理使用者
      </button>
    </div>
  {/if}
</div>

<style>
  .user {
    position: relative;
  }
  .who {
    width: 44px;
    height: 44px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--sky);
    box-shadow: var(--shadow-sm);
    display: grid;
    place-items: center;
    font-size: 18px;
  }
  .menu {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 30;
    width: 220px;
    padding: 6px;
    display: grid;
    gap: 2px;
  }
  .item {
    min-height: 48px;
    padding: 4px 10px 4px 6px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    font-size: 17px;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--paper, #fff8ec);
  }
  .item[aria-checked='true'] {
    background: var(--butter);
  }
  .avatar {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--sky);
    display: grid;
    place-items: center;
    font-size: 15px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pending {
    flex: none;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: var(--coral);
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    display: grid;
    place-items: center;
  }
  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 2px dashed var(--faint);
  }
  .manage {
    gap: 12px;
    padding-left: 14px;
    font-size: 16px;
    color: var(--pencil);
  }
</style>
