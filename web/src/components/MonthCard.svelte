<script lang="ts">
  import mascot from '../assets/mascot.webp';
  import { app } from '../lib/app-state.svelte';
  import { catMessage, formatNumber, goalMet, progressPercent } from '../lib/calc';
  import Icon from './Icon.svelte';
  import Stamp from './Stamp.svelte';

  const RADIUS = 47;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const total = $derived(app.total);
  const required = $derived(app.requiredHours);
  const percent = $derived(progressPercent(total, required));
  const met = $derived(goalMet(total, required));
  const message = $derived(app.ready ? catMessage(total, required) : '讀取中，稍等一下喵');

  // 輸入框的文字：使用者正在輸入時不覆蓋，切換月份或還原時才更新
  let text = $state('');
  let focused = $state(false);
  let error = $state('');
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const value = required;
    app.monthKey;
    if (!focused) text = value === null ? '' : String(value);
  });
  $effect(() => {
    app.monthKey;
    error = '';
  });

  function save(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const message = app.saveRequired(input.value, input.validity.badInput);
    clearTimeout(errorTimer);
    error = message;
    if (message) {
      text = required === null ? '' : String(required);
      input.value = text;
      errorTimer = setTimeout(() => (error = ''), 5000);
    }
  }

  // 達標時撒一次彩帶
  let confetti = $state(0);
  let lastCelebrate = app.celebrate;
  $effect(() => {
    if (app.celebrate !== lastCelebrate) {
      lastCelebrate = app.celebrate;
      confetti++;
    }
  });
  const PIECES = [
    ['18%', '#f27262', 20], ['32%', '#bad3f5', 50], ['46%', '#ffe9a8', 10], ['60%', '#faa5a1', 35],
    ['72%', '#bfe6cf', 70], ['84%', '#f27262', 15], ['92%', '#bad3f5', 40],
  ] as const;
</script>

<section class="card sticker" class:done={met} aria-label="本月進度">
  <span class="tape" style="left:16px;top:-12px;transform:rotate(-7deg)"></span>
  <Stamp />
  {#key confetti}
    {#if confetti}
      <div class="confetti" aria-hidden="true">
        {#each PIECES as [left, color, turn], i (i)}
          <b style:left style:background={color} style:--turn="{turn}deg" style:animation-delay="{i * 40}ms"></b>
        {/each}
      </div>
    {/if}
  {/key}

  <div class="ring" class:dashed={percent === null}>
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <circle cx="56" cy="56" r={RADIUS} class="track" />
      <circle cx="56" cy="56" r="54" class="edge" />
      <circle cx="56" cy="56" r="40" class="edge" />
      {#if percent !== null && percent > 0}
        <circle
          cx="56" cy="56" r={RADIUS}
          class="progress" class:met
          stroke-dasharray="{(CIRCUMFERENCE * Math.min(percent, 100)) / 100} {CIRCUMFERENCE}"
        />
      {/if}
    </svg>
    <div class="face" style:background-image="url({mascot})"></div>
    {#if percent !== null}
      <span class="percent">{Math.round(percent)}%</span>
    {/if}
    {#if met}
      <span class="trophy" title="達標"><Icon name="trophy" label="達標" /></span>
    {/if}
  </div>

  <div class="info">
    <label for="required" class="label"><Icon name="penNib" />應上班時數</label>
    <div class="required" class:invalid={error}>
      <input
        id="required"
        type="number"
        inputmode="decimal"
        min="0"
        max="744"
        step="0.25"
        placeholder="—"
        disabled={!app.ready}
        aria-describedby={error ? 'required-error' : undefined}
        value={text}
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onchange={save}
      />
      <span>小時</span>
      <Icon name="pen" />
    </div>
    {#if error}
      <p class="error" id="required-error" role="alert"><Icon name="circleExclamation" />{error}</p>
    {:else}
      <p class="stat">已排 <b>{app.ready ? `${formatNumber(total)}h` : '–'}</b></p>
      <p class="note"><Icon name={met ? 'heart' : 'paw'} />{message}</p>
    {/if}
  </div>
</section>

<style>
  .card {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 18px 14px 14px;
  }
  .card.done {
    background: #f3fbf6;
  }
  .ring {
    position: relative;
    flex: none;
    width: 112px;
    height: 112px;
  }
  .ring svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
    overflow: visible;
  }
  circle {
    fill: none;
  }
  .track {
    stroke: var(--sky-soft);
    stroke-width: 12;
  }
  .edge {
    stroke: var(--ink);
    stroke-width: 2.5;
  }
  .dashed .edge {
    stroke-dasharray: 5 6;
  }
  .progress {
    stroke: var(--coral);
    stroke-width: 12;
    stroke-linecap: round;
    transition: stroke-dasharray 0.5s ease-out;
  }
  .progress.met {
    stroke: var(--green);
  }
  .face {
    position: absolute;
    left: 18px;
    top: 18px;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    border: 2.5px solid var(--ink);
    background-color: var(--sky-soft);
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 122%;
  }
  .percent {
    position: absolute;
    right: -6px;
    bottom: -2px;
    padding: 0 6px;
    border: 2px solid var(--ink);
    border-radius: 10px;
    background: var(--card);
    font-weight: 900;
    font-size: 13px;
    transform: rotate(6deg);
  }
  .trophy {
    position: absolute;
    left: -6px;
    top: -4px;
    width: 30px;
    height: 30px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--butter);
    display: grid;
    place-items: center;
    font-size: 14px;
    color: #b07a00;
    transform: rotate(-10deg);
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .label {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 15px;
    color: var(--pencil);
  }
  .required {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 6px;
    padding: 0 10px;
    height: 48px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    color: var(--pencil);
    font-size: 15px;
  }
  .required.invalid {
    border-color: var(--time);
    background: #fff6f5;
  }
  .required input {
    width: 3.6em;
    border: 0;
    background: transparent;
    font-weight: 900;
    font-size: 26px;
    color: var(--ink);
    padding: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .required input::-webkit-inner-spin-button,
  .required input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .required input:focus {
    outline: none;
  }
  .required:focus-within {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .required input:disabled {
    opacity: 0.5;
  }
  .required input::placeholder {
    color: var(--faint);
  }
  p {
    margin: 0;
  }
  .stat {
    font-size: 14px;
    color: var(--pencil);
  }
  .stat b {
    color: var(--ink);
    font-weight: 900;
  }
  .note {
    margin-top: 6px;
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 15px;
    line-height: 1.35;
  }
  .note :global(.icon) {
    color: var(--coral);
  }
  .error {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 13px;
    line-height: 1.35;
    color: var(--time);
  }
  .confetti {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
    z-index: 4;
  }
  .confetti b {
    position: absolute;
    top: 0;
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--ink);
    border-radius: 2px;
    opacity: 0;
    animation: pop 1.4s ease-out forwards;
  }
  @keyframes pop {
    0% {
      opacity: 1;
      transform: translateY(10px) rotate(0);
    }
    60% {
      opacity: 1;
      transform: translateY(-34px) rotate(var(--turn));
    }
    100% {
      opacity: 0;
      transform: translateY(-14px) rotate(calc(var(--turn) * 2));
    }
  }
</style>
