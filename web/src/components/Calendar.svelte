<script lang="ts">
  import { fade } from 'svelte/transition';
  import { app } from '../lib/app-state.svelte';
  import { WEEKDAYS, dayLabel, effectiveTime, formatNumber, formatTime, toIso } from '../lib/calc';
  import { DAY_TYPE_ICONS } from '../lib/icons';
  import Icon from './Icon.svelte';

  const SHORT: Record<string, string> = { 例假: '例假', 休假: '休假', 國定假日: '國定' };
  const KIND: Record<string, string> = { 例假: 'off', 休假: 'off', 國定假日: 'holiday' };

  const weeks = $derived(app.weeks);
  const total = $derived(app.total);
  const required = $derived(app.requiredHours);
  // 跟著月份重新計算，App 開著跨過午夜時，切換月份就會更新今天
  const todayIso = $derived.by(() => {
    app.monthKey;
    return toIso(new Date());
  });
</script>

<section class="calendar sticker" aria-label="{app.year} 年 {app.month + 1} 月">
  <span class="tape sky" style="left:50%;top:-12px;transform:translateX(-50%) rotate(2deg)"></span>
  {#key app.monthKey}
    <div class="grid" in:fade={{ duration: 150 }}>
      {#each WEEKDAYS as name, i (name)}
        <div class="weekday" class:sat={i === 5} class:sun={i === 6}>{name}</div>
      {/each}
      <div class="weekday total-head">合計</div>

      {#each weeks as week, w (w)}
        {#each week.days as date (date.getTime())}
          {#if date.getMonth() === app.month}
            {@const iso = toIso(date)}
            {@const entry = app.entries[iso]}
            {@const time = effectiveTime(entry)}
            {@const kind = entry?.dayType ? KIND[entry.dayType] : ''}
            <button
              type="button"
              class="day {kind}"
              class:today={iso === todayIso}
              class:selected={app.editing === iso}
              disabled={!app.ready}
              aria-label={dayLabel(date, entry)}
              onclick={() => app.open(iso)}
            >
              <span class="number">
                {#if iso === todayIso}<span class="circle">{date.getDate()}</span>{:else}{date.getDate()}{/if}
              </span>
              {#if !app.ready}
                <span class="ghost"><Icon name="paw" /></span>
              {/if}
              {#if time}
                <span class="time"><span>{formatTime(time.start)}</span><span>{formatTime(time.end)}</span></span>
              {/if}
              {#if entry?.dayType}
                <span class="badge"><Icon name={DAY_TYPE_ICONS[entry.dayType]} /></span>
                {#if !time}<span class="tag">{SHORT[entry.dayType]}</span>{/if}
              {/if}
              {#if iso === todayIso && !time}<span class="paw"><Icon name="paw" /></span>{/if}
            </button>
          {:else}
            <div class="day blank"></div>
          {/if}
        {/each}
        <div class="week">
          <span data-testid="week-total" class:zero={!app.ready || !week.total}>{app.ready ? `${formatNumber(week.total)}h` : '–'}</span>
        </div>
      {/each}
    </div>
  {/key}

  <div class="receipt">
    <div><span>週合計加總</span><i></i><b data-testid="grand-total">{app.ready ? `${formatNumber(total)}h` : '–'}</b></div>
    {#if app.ready && required !== null}
      <div><span>加班時數</span><i></i><b data-testid="overtime" class:plus={total - required > 0}>{formatNumber(total - required)}h</b></div>
    {/if}
  </div>
</section>

<style>
  .calendar {
    padding: 10px 6px 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr)) 58px;
  }
  .weekday {
    text-align: center;
    font-size: 15px;
    color: var(--pencil);
    padding-bottom: 4px;
    border-bottom: 2px solid var(--ink);
  }
  .sat {
    color: var(--blue-text);
  }
  .sun {
    color: var(--time);
  }
  .total-head {
    color: var(--ink);
  }
  .day {
    position: relative;
    min-width: 0;
    height: 62px;
    padding: 3px;
    border: 0;
    border-right: 1.5px dashed var(--faint);
    border-bottom: 1.5px dashed var(--faint);
    border-radius: 0;
    background: transparent;
    text-align: left;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    color: inherit;
  }
  button.day:not(:disabled):hover {
    background: rgba(186, 211, 245, 0.25);
  }
  .day:focus-visible {
    outline-offset: -3px;
  }
  .off {
    background: var(--off);
  }
  .holiday {
    background: var(--holiday);
  }
  .today {
    background: rgba(186, 211, 245, 0.28);
  }
  .selected {
    background: var(--butter);
    box-shadow: inset 0 0 0 2.5px var(--ink);
  }
  .number {
    height: 18px;
    display: flex;
    align-items: center;
    font-weight: 800;
    font-size: 12px;
    color: var(--pencil);
  }
  .circle {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--sky);
    color: var(--ink);
    display: grid;
    place-items: center;
    font-size: 11px;
  }
  .time {
    margin-top: 1px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
  }
  .time span {
    padding: 0 1px;
    font-weight: 900;
    font-size: 12.5px;
    line-height: 1.1;
    color: var(--time);
    background: linear-gradient(transparent 62%, rgba(186, 211, 245, 0.85) 62%);
  }
  .badge {
    position: absolute;
    right: 3px;
    top: 3px;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    border: 1.5px solid var(--ink);
    display: grid;
    place-items: center;
    font-size: 8px;
  }
  .off .badge,
  .off .tag {
    background: var(--off-tag);
  }
  .holiday .badge,
  .holiday .tag {
    background: var(--holiday-tag);
  }
  .tag {
    position: absolute;
    left: 4px;
    bottom: 6px;
    padding: 0 4px;
    border: 1.5px solid var(--ink);
    border-radius: 6px;
    font-size: 12px;
    transform: rotate(-5deg);
  }
  .paw {
    position: absolute;
    right: 3px;
    bottom: 3px;
    font-size: 10px;
    color: var(--coral);
  }
  .ghost {
    margin: auto;
    font-size: 15px;
    color: rgba(69, 43, 51, 0.12);
    transform: rotate(-15deg);
  }
  .blank {
    background: transparent;
  }
  .week {
    display: grid;
    place-items: center;
    border-bottom: 1.5px dashed var(--faint);
  }
  .week span {
    padding: 5px 6px 4px;
    border: 2px solid var(--ink);
    border-radius: 10px;
    background: var(--sky);
    box-shadow: var(--shadow-sm);
    font-weight: 900;
    font-size: 11.5px;
    white-space: nowrap;
    transform: rotate(-3deg);
  }
  .week span.zero {
    border: 2px dashed var(--faint);
    background: transparent;
    box-shadow: none;
    color: var(--pencil);
    font-weight: 700;
    transform: none;
  }
  .receipt {
    display: grid;
    gap: 4px;
    padding: 10px 6px 4px;
  }
  .receipt div {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 16px;
  }
  .receipt i {
    flex: 1;
    border-bottom: 2.5px dotted var(--faint);
    transform: translateY(-5px);
  }
  .receipt b {
    font-weight: 900;
    font-size: 19px;
  }
  .receipt b.plus {
    color: var(--green-text);
  }

  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(7, minmax(0, 1fr)) 78px;
    }
    .day {
      height: 92px;
      padding: 7px;
    }
    .number {
      font-size: 14px;
    }
    .time span {
      font-size: 16px;
    }
    .badge {
      width: 22px;
      height: 22px;
      font-size: 10px;
      right: 6px;
      top: 6px;
    }
    .tag {
      font-size: 14px;
      left: 7px;
      bottom: 9px;
    }
    .weekday {
      font-size: 17px;
      padding-bottom: 6px;
    }
    .week span {
      font-size: 15px;
    }
    .receipt div {
      font-size: 18px;
    }
    .receipt b {
      font-size: 22px;
    }
  }
</style>
