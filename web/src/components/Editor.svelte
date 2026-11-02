<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import mascot from '../assets/mascot.webp';
  import { app } from '../lib/app-state.svelte';
  import { HOURS, MINUTES, formatNumber, formatTime, pad, weekdayOf } from '../lib/calc';
  import { DAY_TYPE_ICONS } from '../lib/icons';
  import type { DayType } from '../lib/types';
  import Icon from './Icon.svelte';

  type Pair = [number | null, number | null];
  type Tab = 'planned' | 'actual';

  let { mode }: { mode: 'sheet' | 'panel' } = $props();

  // 開啟時複製一份當天的紀錄當草稿，按儲存才寫回
  const date = app.editing as string;
  const entry = app.entries[date];
  const [year, month, day] = date.split('-').map(Number);
  const weekday = weekdayOf(new Date(year, month - 1, day));

  let planned = $state<Pair>([entry?.plannedStart ?? null, entry?.plannedEnd ?? null]);
  let actual = $state<Pair>([entry?.actualStart ?? null, entry?.actualEnd ?? null]);
  let dayType = $state<DayType>(entry?.dayType ?? '');
  let tab = $state<Tab>(entry && Number.isFinite(entry.actualStart) ? 'actual' : 'planned');
  let field = $state<0 | 1>(0);
  let error = $state('');

  const pair = $derived(tab === 'planned' ? planned : actual);
  const value = $derived(pair[field]);
  const complete = (p: Pair) => p[0] !== null && p[1] !== null;
  // 有填實際就以實際為準，否則以原定為準
  const effective = $derived<Tab | null>(complete(actual) ? 'actual' : complete(planned) ? 'planned' : null);

  const TAB_NAMES: Record<Tab, string> = { planned: '原定', actual: '實際' };
  const TYPES: [DayType, string][] = [['', '無'], ['例假', '例假'], ['休假', '休假'], ['國定假日', '國定假日']];

  const show = (v: number | null) => (v === null ? '--' : formatTime(v));
  function summary(p: Pair, isActual: boolean) {
    if (p[0] === null && p[1] === null) return isActual ? '未填，以原定為準' : '未填';
    const text = `${show(p[0])} → ${show(p[1])}`;
    return p[0] !== null && p[1] !== null && p[1] > p[0] ? `${text}・${formatNumber(p[1] - p[0])}h` : text;
  }

  function setValue(next: number | null) {
    if (tab === 'planned') planned[field] = next;
    else actual[field] = next;
    error = '';
  }

  function pickHour(hour: number) {
    const minute = value === null ? 0 : value - Math.floor(value);
    setValue(hour + minute);
  }

  // 選完上班的分鐘，自動切到下班
  function pickMinute(minute: number) {
    if (value === null) return;
    setValue(Math.floor(value) + minute);
    if (field === 0) field = 1;
  }

  function clearPair() {
    if (tab === 'planned') planned = [null, null];
    else actual = [null, null];
    field = 0;
    error = '';
  }

  function switchTab(next: Tab) {
    tab = next;
    field = 0;
  }

  function save() {
    error = app.saveEntry({
      date,
      plannedStart: planned[0],
      plannedEnd: planned[1],
      actualStart: actual[0],
      actualEnd: actual[1],
      dayType,
    });
  }

  // 時間軸 6～22 點
  const position = (t: number) => ((t - 6) / 16) * 100;
  const TICKS = [6, 9, 12, 15, 18, 21];

  let heading = $state<HTMLElement>();
  $effect(() => {
    heading?.focus({ preventScroll: true });
  });

  $effect(() => {
    if (mode !== 'sheet') return;
    document.body.classList.add('locked');
    return () => document.body.classList.remove('locked');
  });
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && app.close()} />

{#snippet body()}
  <h2 id="editor-title" tabindex="-1" bind:this={heading}>
    <b>{month}</b>月<b>{day}</b>日<small>星期{weekday}</small>
  </h2>

  <div class="tabs">
    {#each ['planned', 'actual'] as const as name (name)}
      {@const p = name === 'planned' ? planned : actual}
      <button type="button" class="tab" class:on={tab === name} aria-pressed={tab === name} onclick={() => switchTab(name)}>
        <span class="tab-name">
          <Icon name={name === 'planned' ? 'clock' : 'pencil'} />{TAB_NAMES[name]}
          {#if effective === name}<em>以這組為準</em>{/if}
        </span>
        <small>{summary(p, name === 'actual')}</small>
      </button>
    {/each}
  </div>

  <div class="timeline" aria-hidden="true">
    {#if planned[0] !== null && planned[1] !== null && planned[1] > planned[0]}
      <div class="bar plan" style:left="{position(planned[0])}%" style:width="{position(planned[1]) - position(planned[0])}%"></div>
    {/if}
    {#if actual[0] !== null && actual[1] !== null && actual[1] > actual[0]}
      <div class="bar act" style:left="{position(actual[0])}%" style:width="{position(actual[1]) - position(actual[0])}%"></div>
    {/if}
    <div class="axis"></div>
    {#each TICKS as t (t)}
      <span class="tick" style:left="{position(t)}%"></span>
      <span class="tick-label" style:left="{position(t)}%">{t}</span>
    {/each}
  </div>

  <div class="fields">
    {#each [0, 1] as const as index (index)}
      <button type="button" class="field press" class:on={field === index} aria-pressed={field === index} onclick={() => (field = index)}>
        <small>{index === 0 ? '上班' : '下班'}</small>
        <b>{show(pair[index])}</b>
      </button>
      {#if index === 0}<span class="to"><Icon name="arrowRight" /></span>{/if}
    {/each}
  </div>

  <div class="hours" class:wide={mode === 'sheet'} role="radiogroup" aria-label="{TAB_NAMES[tab]}{field === 0 ? '上班' : '下班'}的小時">
    {#each HOURS as hour (hour)}
      <button type="button" role="radio" class="chip press" aria-checked={value !== null && Math.floor(value) === hour} onclick={() => pickHour(hour)}>
        {pad(hour)}
      </button>
    {/each}
  </div>

  <div class="minutes" role="radiogroup" aria-label="{TAB_NAMES[tab]}{field === 0 ? '上班' : '下班'}的分鐘">
    {#each MINUTES as [minute, label] (minute)}
      <button
        type="button"
        role="radio"
        class="chip press"
        aria-checked={value !== null && value - Math.floor(value) === minute}
        disabled={value === null}
        onclick={() => pickMinute(minute)}
      >
        {label}
      </button>
    {/each}
    <button type="button" class="chip clear" onclick={clearPair}>清除這組</button>
  </div>

  <div class="types" role="radiogroup" aria-label="假別">
    {#each TYPES as [type, label] (type)}
      <button
        type="button"
        role="radio"
        class="type"
        class:off={type === '例假' || type === '休假'}
        class:holiday={type === '國定假日'}
        aria-checked={dayType === type}
        onclick={() => (dayType = type)}
      >
        {#if type}<Icon name={DAY_TYPE_ICONS[type]} />{/if}{label}
      </button>
    {/each}
  </div>

  {#if error}
    <p class="error" role="alert"><Icon name="circleExclamation" />{error}</p>
  {/if}

  <div class="actions">
    {#if entry}
      <button type="button" class="delete" onclick={() => app.deleteEntry(date)}><Icon name="trashCan" />刪除</button>
    {/if}
    <button type="button" class="cancel" onclick={() => app.close()}>取消</button>
    <button type="button" class="save press" onclick={save}><Icon name="paw" />儲存</button>
  </div>
{/snippet}

{#if mode === 'sheet'}
  <div class="backdrop" transition:fade={{ duration: 200 }} onclick={() => app.close()} aria-hidden="true"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="editor-title" transition:fly={{ y: 500, duration: 250, opacity: 1 }}>
    <div class="cat" style:background-image="url({mascot})" aria-hidden="true"></div>
    <div class="sheet-body">
      <div class="handle" aria-hidden="true"></div>
      {@render body()}
    </div>
  </div>
{:else}
  <div class="panel sticker" role="dialog" aria-labelledby="editor-title">
    <div class="cat" style:background-image="url({mascot})" aria-hidden="true"></div>
    <button type="button" class="close press" aria-label="關閉" onclick={() => app.close()}><Icon name="xmark" /></button>
    {@render body()}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(69, 43, 51, 0.38);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    max-width: 560px;
    margin: 0 auto;
    border: 2.5px solid var(--ink);
    border-bottom: 0;
    border-radius: 28px 28px 0 0;
    background-color: var(--paper);
    background-image: radial-gradient(var(--dot) 1.3px, transparent 1.5px);
    background-size: 18px 18px;
  }
  .sheet-body {
    max-height: calc(100dvh - 100px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 16px calc(18px + var(--safe-bottom));
  }
  .sheet .cat {
    position: absolute;
    right: 26px;
    top: -84px;
    width: 84px;
    height: 88px;
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 84px auto;
    pointer-events: none;
  }
  .handle {
    width: 46px;
    height: 6px;
    margin: 0 auto 8px;
    border-radius: 3px;
    background: var(--faint);
  }
  .panel {
    padding: 14px 16px 16px;
    margin-top: 66px;
    background-color: var(--paper);
    background-image: radial-gradient(var(--dot) 1.3px, transparent 1.5px);
    background-size: 18px 18px;
  }
  .panel .cat {
    position: absolute;
    right: 70px;
    top: -72px;
    width: 78px;
    height: 82px;
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 78px auto;
    pointer-events: none;
  }
  .close {
    position: absolute;
    right: 14px;
    top: 14px;
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
  h2 {
    margin: 0;
    font-size: 30px;
    font-weight: 400;
    display: flex;
    align-items: baseline;
    gap: 2px;
  }
  h2:focus {
    outline: none;
  }
  h2 b {
    font-weight: 900;
  }
  h2 small {
    margin-left: 8px;
    font-size: 17px;
    color: var(--pencil);
  }
  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 12px;
  }
  .tab {
    min-height: 54px;
    padding: 4px 12px;
    border: 2px dashed var(--faint);
    border-radius: 14px;
    background: transparent;
    text-align: left;
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-size: 15px;
  }
  .tab.on {
    border: 2.5px solid var(--ink);
    background: var(--card);
    box-shadow: var(--shadow);
  }
  .tab-name {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .tab em {
    font-style: normal;
    font-size: 11px;
    padding: 0 4px;
    border: 1.5px solid var(--ink);
    border-radius: 6px;
    background: var(--butter);
  }
  .tab small {
    font-weight: 800;
    font-size: 13px;
    color: var(--pencil);
  }
  .tab.on small {
    color: var(--time);
  }
  .timeline {
    position: relative;
    height: 52px;
    margin: 14px 4px 0;
  }
  .bar {
    position: absolute;
    border: 2px solid var(--ink);
    border-radius: 8px;
  }
  .plan {
    top: 2px;
    height: 12px;
    background: repeating-linear-gradient(-45deg, var(--sky) 0 4px, var(--card) 4px 8px);
  }
  .act {
    top: 16px;
    height: 16px;
    background: var(--coral);
  }
  .axis {
    position: absolute;
    left: 0;
    right: 0;
    top: 36px;
    border-top: 2px solid var(--ink);
  }
  .tick {
    position: absolute;
    top: 31px;
    width: 2px;
    height: 10px;
    margin-left: -1px;
    background: var(--ink);
  }
  .tick-label {
    position: absolute;
    top: 40px;
    transform: translateX(-50%);
    font-size: 11px;
    font-weight: 800;
    color: var(--pencil);
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 26px 1fr;
    align-items: center;
    margin-top: 14px;
  }
  .field {
    height: 58px;
    padding: 4px 12px;
    border: 2px dashed var(--faint);
    border-radius: 16px;
    background: transparent;
    text-align: left;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .field small {
    font-size: 13px;
    color: var(--pencil);
  }
  .field b {
    font-weight: 900;
    font-size: 24px;
    line-height: 1.1;
  }
  .field.on {
    border: 2.5px solid var(--ink);
    background: var(--sky-soft);
    box-shadow: var(--shadow);
  }
  .to {
    text-align: center;
    color: var(--pencil);
  }
  .hours {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-top: 12px;
  }
  .hours.wide {
    grid-template-columns: repeat(8, 1fr);
  }
  .minutes {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 1.4fr;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    height: 44px;
    border: 1.5px solid var(--faint);
    border-radius: 11px;
    background: var(--card);
    font-weight: 800;
    font-size: 15px;
  }
  .chip[aria-checked='true'] {
    border: 2.5px solid var(--ink);
    background: var(--butter);
    box-shadow: var(--shadow-sm);
    font-weight: 900;
  }
  .chip:disabled {
    opacity: 0.45;
  }
  .clear {
    border-style: dashed;
    color: var(--pencil);
    font-weight: 400;
    font-size: 13px;
  }
  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 14px;
  }
  .type {
    height: 44px;
    padding: 0 12px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 15px;
  }
  .type.off {
    background: var(--off);
  }
  .type.holiday {
    background: var(--holiday);
  }
  .type[aria-checked='true'] {
    background: var(--ink);
    color: var(--card);
    box-shadow: 2px 2px 0 rgba(69, 43, 51, 0.45);
  }
  .error {
    margin: 12px 0 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 14px;
    color: var(--time);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .delete {
    height: 46px;
    padding: 0 14px;
    border: 2px solid var(--time);
    border-radius: 14px;
    background: var(--card);
    color: var(--time);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 15px;
  }
  .cancel {
    margin-left: auto;
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    font-size: 16px;
  }
  .save {
    height: 52px;
    padding: 0 26px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    background: var(--sky);
    box-shadow: var(--shadow);
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 19px;
  }
  .save :global(.icon) {
    color: var(--coral);
  }
</style>
