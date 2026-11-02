<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/app-state.svelte';

  // 跨年連續的月份標籤：前後各 12 個月，每年 1 月前面插一個年份分隔
  const SPAN = 12;
  const chips = $derived(
    Array.from({ length: SPAN * 2 + 1 }, (_, i) => {
      const date = new Date(app.year, app.month - SPAN + i, 1);
      return { year: date.getFullYear(), month: date.getMonth(), selected: i === SPAN };
    }),
  );

  let strip: HTMLElement;
  let first = true;

  // 選中的月份捲到中間；第一次直接定位，之後平滑捲動
  $effect(() => {
    app.monthKey;
    tick().then(() => {
      const chip = strip?.querySelector<HTMLElement>('[aria-current="date"]');
      if (!chip) return;
      const left = chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2;
      strip.scrollTo({ left, behavior: first ? 'instant' : 'smooth' });
      first = false;
    });
  });
</script>

<nav class="strip" bind:this={strip} aria-label="月份">
  {#each chips as chip (`${chip.year}-${chip.month}`)}
    {#if chip.month === 0}
      <span class="divider" aria-hidden="true">{chip.year}</span>
    {/if}
    <button
      type="button"
      class="chip"
      class:selected={chip.selected}
      aria-current={chip.selected ? 'date' : undefined}
      aria-label="{chip.year} 年 {chip.month + 1} 月"
      onclick={() => app.goTo(chip.year, chip.month)}
    >
      <b>{chip.month + 1}</b>月
    </button>
  {/each}
</nav>

<style>
  .strip {
    display: flex;
    gap: 8px;
    align-items: center;
    overflow-x: auto;
    padding: 8px 16px 12px;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent);
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    height: 44px;
    min-width: 52px;
    padding: 0 9px;
    border-radius: 13px;
    border: 2px dashed var(--faint);
    background: transparent;
    color: var(--pencil);
    font-size: 16px;
    white-space: nowrap;
  }
  .chip b {
    font-weight: 900;
  }
  .chip:hover {
    border-color: var(--pencil);
  }
  .selected {
    height: 50px;
    min-width: 72px;
    background: var(--sky);
    border: 2.5px solid var(--ink);
    color: var(--ink);
    box-shadow: var(--shadow);
    transform: rotate(-3deg);
    font-size: 21px;
  }
  .divider {
    flex: none;
    height: 28px;
    padding: 0 9px;
    border: 2px solid var(--blue-text);
    border-radius: 999px;
    background: var(--card);
    color: var(--blue-text);
    font-size: 13px;
    font-weight: 900;
    display: grid;
    place-items: center;
  }
</style>
