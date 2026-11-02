<script lang="ts">
  import type { ItemMode } from '../lib/types';

  let { mode = $bindable(), value = $bindable(), label, unitLabel, id }: { mode: ItemMode; value: number; label: string; unitLabel: string; id?: string } = $props();

  const toNumber = (event: Event) => {
    const parsed = (event.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(parsed) ? parsed : 0;
  };
</script>

<!-- 單位按鈕可以在「金額（NT$）」與「比例（%）」之間切換；數值 0 顯示成空白，直接就能輸入 -->
<div class="amount">
  <button
    type="button"
    class="unit press"
    aria-label="{unitLabel}單位，現在是{mode === 'percent' ? '比例（%）' : '金額（NT$）'}，點一下切換"
    onclick={() => (mode = mode === 'percent' ? 'amount' : 'percent')}
  >
    {mode === 'percent' ? '%' : 'NT$'}
  </button>
  <input
    {id}
    type="number"
    inputmode="decimal"
    min="0"
    max={mode === 'percent' ? 100 : undefined}
    step={mode === 'percent' ? 0.1 : 1}
    aria-label={label}
    placeholder="0"
    value={value === 0 ? '' : String(value)}
    oninput={(event) => (value = toNumber(event))}
  />
</div>

<style>
  .amount {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 44px;
    border: 2.5px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    overflow: hidden;
  }
  .amount:focus-within {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .unit {
    flex: none;
    align-self: stretch;
    min-width: 52px;
    padding: 0 8px;
    border: 0;
    border-right: 2px solid var(--ink);
    background: var(--sky-soft);
    font-size: 14px;
    font-weight: 800;
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 0 10px;
    border: 0;
    background: transparent;
    font-size: 18px;
    font-weight: 800;
  }
  input:focus {
    outline: none;
  }
</style>
