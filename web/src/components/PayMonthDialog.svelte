<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/app-state.svelte';
    import {
    DAYS_PER_MONTH, DAY_HOURS, ROUNDINGS, blankMonthPay, draftMonthPay, formatExact, formatMoney, hourlyFromBase, minimumWage,
    overtimePreview, resolveMonthPay,
  } from '../lib/pay';
  import type { MonthPay } from '../lib/types';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import PayItemsEditor from './PayItemsEditor.svelte';

  let draft = $state<MonthPay>(blankMonthPay());
  let error = $state('');
  let confirmingReset = $state(false);

  const month = $derived(app.payDialogMonth);
  const monthLabel = $derived(month ? `${Number(month.slice(5))} 月` : '');
  const resolved = $derived(month ? resolveMonthPay(app.payMonths, month) : null);
  const hasOwn = $derived(Boolean(month && app.payMonths[month]));
  const additionCategories = $derived(app.catalog.categories.filter((c) => c.side === 'addition'));
  const deductionCategories = $derived(app.catalog.categories.filter((c) => c.side === 'deduction'));

  // 打開時才取一份草稿；之後同步到新的設定也不會把正在填的內容洗掉
  $effect(() => {
    if (!month) return;
    draft = untrack(() => draftMonthPay($state.snapshot(app.payMonths), month));
    error = '';
    confirmingReset = false;
  });

  const toNumber = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(value) ? value : 0;
  };
  const show = (value: number) => (value === 0 ? '' : String(value));

  const minimum = $derived(minimumWage(month ?? app.monthKey));
  const rawHourly = $derived(draft.baseSalary / (DAYS_PER_MONTH * DAY_HOURS));
  const hourly = $derived(hourlyFromBase(draft.baseSalary, draft.rounding));
  const preview = $derived(overtimePreview(draft));
  // 除不盡的時薪要看得出來；選了進位就顯示進位後的整數，不進位則說明會用完整的數字去乘
  const hourlyTail = $derived(draft.rounding === 'none' ? '，不進位，用完整的數字去乘' : ` → ${hourly} 元`);
  const hasWage = $derived(draft.jobType === 'fulltime' ? draft.baseSalary > 0 : draft.hourlyWage > 0);
  const wageWarning = $derived.by(() => {
    if (draft.jobType === 'parttime' && draft.hourlyWage > 0 && draft.hourlyWage < minimum.hourly) {
      return `低於 ${minimum.year} 年基本工資時薪 ${minimum.hourly} 元`;
    }
    if (draft.jobType === 'fulltime' && draft.baseSalary > 0 && draft.baseSalary < minimum.monthly) {
      return `低於 ${minimum.year} 年基本工資月薪 ${formatMoney(minimum.monthly)}`;
    }
    return '';
  });

  function reset() {
    if (!confirmingReset) {
      confirmingReset = true;
      return;
    }
    app.resetPayMonth();
  }
</script>

<Modal
  open={month !== null}
  title="{monthLabel}薪資設定"
  titleId="pay-title"
  icon="sackDollar"
  onclose={() => app.closePayDialog()}
  onsubmit={() => (error = app.savePayMonth(draft))}
>
  <p class="scope" data-testid="pay-scope">
    <Icon name="circleInfo" />
    {#if resolved && resolved.source === 'inherited'}
      目前沿用 {Number(resolved.from.slice(5))} 月的設定。儲存後，這個月就有自己的設定。
    {:else}
      從 {monthLabel}起生效，不會影響更早的月份；之後沒有自己設定的月份會沿用這份設定。
    {/if}
  </p>

  <fieldset>
    <legend>身分</legend>
    <div class="choices two" role="radiogroup" aria-label="身分">
      <button type="button" role="radio" class="choice" aria-checked={draft.jobType === 'fulltime'} onclick={() => (draft.jobType = 'fulltime')}>
        正職<small>月薪制</small>
      </button>
      <button type="button" role="radio" class="choice" aria-checked={draft.jobType === 'parttime'} onclick={() => (draft.jobType = 'parttime')}>
        工讀生<small>時薪制</small>
      </button>
    </div>
  </fieldset>

  {#if draft.jobType === 'fulltime'}
    <div class="field">
      <label for="pay-base">本薪（每月）</label>
      <div class="money"><span>NT$</span><input id="pay-base" type="number" inputmode="decimal" min="0" step="1" placeholder="0" value={show(draft.baseSalary)} oninput={(event) => (draft.baseSalary = toNumber(event))} /></div>
    </div>

    <fieldset>
      <legend>時薪的進位方式</legend>
      <div class="choices three" role="radiogroup" aria-label="時薪的進位方式">
        {#each ROUNDINGS as option (option.value)}
          <button type="button" role="radio" class="choice" aria-checked={draft.rounding === option.value} onclick={() => (draft.rounding = option.value)}>
            {option.label}
          </button>
        {/each}
      </div>
      <p class="hint" data-testid="hourly-preview">
        {#if draft.baseSalary > 0}
          時薪 = {draft.baseSalary.toLocaleString('en-US')} ÷ {DAYS_PER_MONTH} ÷ {DAY_HOURS} = <b>{formatExact(rawHourly)}</b>{hourlyTail}
        {:else}
          填上本薪就會算出時薪（本薪 ÷ {DAYS_PER_MONTH} ÷ {DAY_HOURS}）
        {/if}
      </p>
    </fieldset>
  {:else}
    <div class="field">
      <label for="pay-hourly">時薪</label>
      <div class="money"><span>NT$</span><input id="pay-hourly" type="number" inputmode="decimal" min="0" step="1" placeholder="0" value={show(draft.hourlyWage)} oninput={(event) => (draft.hourlyWage = toNumber(event))} /></div>
      <p class="hint">{minimum.year} 年基本工資時薪 {minimum.hourly} 元。工讀生月薪 = 時薪 × 出勤工時。</p>
    </div>
  {/if}
  {#if wageWarning}
    <p class="warning" role="status"><Icon name="triangleExclamation" />{wageWarning}</p>
  {/if}

  <fieldset>
    <legend>金額的進位方式</legend>
    <div class="choices three" role="radiogroup" aria-label="金額的進位方式">
      {#each ROUNDINGS as option (option.value)}
        <button type="button" role="radio" class="choice" aria-checked={draft.payRounding === option.value} onclick={() => (draft.payRounding = option.value)}>
          {option.label}
        </button>
      {/each}
    </div>
    <p class="hint" data-testid="amount-preview">
      {#if hasWage}
        例：{draft.jobType === 'fulltime' ? '加班' : '工作'} {preview.hours} 小時 × 時薪 {formatExact(preview.hourly)}{preview.rate === 1 ? '' : ` × ${preview.rate}`}
        = {formatExact(preview.raw)} → <b>{formatMoney(preview.amount, draft.payRounding === 'none')}</b>
      {:else}
        填上{draft.jobType === 'fulltime' ? '本薪' : '時薪'}就會顯示範例
      {/if}
    </p>
    <p class="hint">時薪乘出來的加班費、假日加給、工資，以及比例的項目，每一行都用這個方式進位；「不進位」會保留到小數第二位。</p>
  </fieldset>

  <PayItemsEditor bind:items={draft.additions} side="addition" categories={additionCategories} onmanage={() => app.openCategories()} />
  <PayItemsEditor bind:items={draft.deductions} side="deduction" categories={deductionCategories} onmanage={() => app.openCategories()} />
  <p class="hint">
    比例是「{draft.jobType === 'fulltime' ? '本薪' : '當月工資'}」的百分比。「每月沿用」的項目，之後沒有自己設定的月份會帶過去；「只限本月」的只算這個月。
  </p>
    {#if hasOwn}
      <button type="button" class="reset" class:confirm={confirmingReset} onclick={reset}>
        <Icon name="trashCan" />{confirmingReset ? '確定清除？' : '清除本月設定'}
      </button>
    {/if}

  {#snippet footer()}
    {#if error}
      <p class="error" role="alert"><Icon name="circleExclamation" />{error}</p>
    {/if}
    <div class="actions">
      <button type="button" class="cancel" onclick={() => app.closePayDialog()}>取消</button>
      <button type="submit" class="save press"><Icon name="paw" />儲存</button>
    </div>
  {/snippet}
</Modal>

<style>
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend,
  .field > label {
    padding: 0;
    margin-bottom: 6px;
    font-size: 16px;
  }
  .field > label {
    display: block;
  }
  .scope {
    margin: 0;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--sky-soft);
    font-size: 13.5px;
    line-height: 1.5;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .scope :global(.icon) {
    color: var(--blue-text);
    flex: none;
  }
  .choices {
    display: grid;
    gap: 8px;
  }
  .two {
    grid-template-columns: 1fr 1fr;
  }
  .three {
    grid-template-columns: repeat(3, 1fr);
  }
  .choice {
    min-height: 48px;
    padding: 4px 8px;
    border: 2px dashed var(--faint);
    border-radius: 14px;
    background: transparent;
    font-size: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .choice small {
    font-size: 12px;
    color: var(--pencil);
  }
  .choice[aria-checked='true'] {
    border: 2.5px solid var(--ink);
    background: var(--sky);
    box-shadow: var(--shadow-sm);
  }
  .choice[aria-checked='true'] small {
    color: var(--ink);
  }
  .money {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 48px;
    padding: 0 12px;
    border: 2.5px solid var(--ink);
    border-radius: 14px;
    background: var(--card);
  }
  .money:focus-within {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .money span {
    flex: none;
    font-size: 14px;
    color: var(--pencil);
  }
  .money input {
    flex: 1;
    min-width: 0;
    width: 100%;
    border: 0;
    background: transparent;
    font-size: 18px;
    font-weight: 800;
    padding: 0;
  }
  .money input:focus {
    outline: none;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--pencil);
  }
  .hint b {
    color: var(--ink);
    font-weight: 900;
  }
  .warning {
    margin: -8px 0 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 14px;
    color: var(--time);
  }
  .error {
    margin: 0 0 8px;
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
  }
  .reset {
    justify-self: start;
    min-height: 44px;
    padding: 0 10px;
    white-space: nowrap;
    border: 2px dashed var(--time);
    border-radius: 12px;
    background: transparent;
    color: var(--time);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 14px;
  }
  .reset.confirm {
    border-style: solid;
    background: var(--holiday);
  }
  .cancel {
    margin-left: auto;
    min-height: 44px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    font-size: 16px;
    white-space: nowrap;
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
    white-space: nowrap;
  }
  .save :global(.icon) {
    color: var(--coral);
  }
</style>
