<script lang="ts">
  import type { Snippet } from 'svelte';
  import mascot from '../assets/mascot.webp';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';

  let { children }: { children?: Snippet } = $props();
  const YEAR_RANGE = 5;
  const years = $derived(Array.from({ length: YEAR_RANGE * 2 + 1 }, (_, i) => app.year - YEAR_RANGE + i));
</script>

<div class="top">
  <div class="logo" style:background-image="url({mascot})"></div>
  <h1>工時貓</h1>
  {@render children?.()}
  <div class="controls">
    <label class="year">
      <span class="visually-hidden">年份</span>
      <select value={app.year} onchange={(event) => app.goTo(Number(event.currentTarget.value), app.month)}>
        {#each years as year (year)}
          <option value={year}>{year} 年</option>
        {/each}
      </select>
      <Icon name="chevronDown" />
    </label>
    <button type="button" class="square press today" aria-label="今天" title="今天" onclick={() => app.goToday()}>
      <Icon name="calendarCheck" />
    </button>
    <button type="button" class="square press" aria-label="連線設定" title="連線設定" onclick={() => app.openSettings()}>
      <Icon name="gear" />
    </button>
  </div>
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .logo {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 2.5px solid var(--ink);
    background-color: var(--sky);
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 128%;
  }
  h1 {
    margin: 0;
    font-size: 23px;
    font-weight: 400;
    white-space: nowrap;
  }
  .controls {
    margin-left: auto;
    display: flex;
    gap: 7px;
    align-items: center;
  }
  .year {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 44px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    font-size: 12px;
  }
  .year select {
    appearance: none;
    height: 100%;
    padding: 0 28px 0 10px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
  }
  .year :global(.icon) {
    position: absolute;
    right: 10px;
    pointer-events: none;
  }
  .square {
    width: 44px;
    height: 44px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: grid;
    place-items: center;
    font-size: 16px;
  }
  .today {
    background: var(--butter);
  }
</style>
