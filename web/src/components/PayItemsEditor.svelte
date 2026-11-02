<script lang="ts">
  import { tick } from 'svelte';
  import { MAX_ITEMS, blankItem, itemFromCategory } from '../lib/pay';
  import type { ItemSide, PayCategory, PayItem } from '../lib/types';
  import AmountField from './AmountField.svelte';
  import Icon from './Icon.svelte';

  let { items = $bindable(), side, categories, onmanage }: {
    items: PayItem[];
    side: ItemSide;
    categories: PayCategory[];
    onmanage: () => void;
  } = $props();

  const title = $derived(side === 'addition' ? '加項' : '扣項');
  const full = $derived(items.length >= MAX_ITEMS);

  async function add(item: PayItem, focus: 'amount' | 'name') {
    items.push(item);
    await tick();
    // 快速加入後，游標直接跳到金額；自訂的跳到名稱
    document.getElementById(`${side}-${focus}-${item.id}`)?.focus();
  }
</script>

<section class="side" class:addition={side === 'addition'} class:deduction={side === 'deduction'} aria-labelledby="{side}-title">
  <h3 id="{side}-title">
    <span class="sign"><Icon name={side === 'addition' ? 'plus' : 'minus'} /></span>{title}
    <small>{side === 'addition' ? '會加到實領薪資' : '會從實領薪資扣掉'}</small>
  </h3>

  <ul class="rows">
    {#each items as item, index (item.id)}
      <li class="row">
        <div class="line">
          <input
            id="{side}-name-{item.id}"
            class="name"
            type="text"
            aria-label="{title} {index + 1} 的名稱"
            placeholder="名稱，例如{side === 'addition' ? '伙食津貼' : '團保'}"
            maxlength="20"
            bind:value={item.name}
          />
          <button type="button" class="trash press" aria-label="刪除{title} {index + 1}" onclick={() => items.splice(index, 1)}>
            <Icon name="trashCan" />
          </button>
        </div>
        <div class="line">
          <AmountField
            id="{side}-amount-{item.id}"
            bind:mode={item.mode}
            bind:value={item.value}
            label="{title} {index + 1} 的{item.mode === 'percent' ? '比例' : '金額'}"
            unitLabel="{title} {index + 1} "
          />
          <button
            type="button"
            class="carry"
            aria-pressed={item.regular}
            aria-label="{title} {index + 1} 每月沿用到之後的月份"
            onclick={() => (item.regular = !item.regular)}
          >
            {item.regular ? '每月沿用' : '只限本月'}
          </button>
        </div>
      </li>
    {/each}
  </ul>

  <div class="quick">
    <span class="quick-label">快速加入</span>
    {#each categories as category (category.id)}
      <button type="button" class="chip press" disabled={full} onclick={() => add(itemFromCategory(category), 'amount')}>
        <Icon name="plus" />{category.name}
      </button>
    {/each}
    <button type="button" class="chip custom press" disabled={full} onclick={() => add(blankItem(), 'name')}>
      <Icon name="pencil" />自訂{title}
    </button>
  </div>
  {#if !categories.length}
    <p class="hint">還沒有常用{title}類別，可以在「管理常用類別」新增。</p>
  {/if}
  <button type="button" class="manage" onclick={onmanage}>管理常用類別</button>
</section>

<style>
  .side {
    padding: 12px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    background: rgba(255, 253, 248, 0.8);
  }
  .addition {
    border-color: var(--green-text);
  }
  .deduction {
    border-color: var(--time);
  }
  h3 {
    margin: 0 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 400;
  }
  h3 small {
    margin-left: auto;
    font-size: 12.5px;
    color: var(--pencil);
  }
  .sign {
    width: 28px;
    height: 28px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 13px;
    color: var(--card);
  }
  .addition .sign {
    background: var(--green-text);
  }
  .deduction .sign {
    background: var(--time);
  }
  .rows {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
  }
  .row {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 2px dashed var(--faint);
    border-radius: 14px;
    background: var(--card);
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    font-size: 16px;
  }
  .name:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .trash {
    flex: none;
    width: 44px;
    height: 44px;
    border: 2px solid var(--time);
    border-radius: 12px;
    background: var(--card);
    color: var(--time);
    display: grid;
    place-items: center;
    font-size: 16px;
  }
  .carry {
    flex: none;
    min-height: 44px;
    padding: 0 10px;
    border: 2px dashed var(--faint);
    border-radius: 12px;
    background: transparent;
    color: var(--pencil);
    font-size: 14px;
  }
  .carry[aria-pressed='true'] {
    border: 2px solid var(--blue-text);
    background: var(--sky-soft);
    color: var(--blue-text);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .quick-label {
    font-size: 13px;
    color: var(--pencil);
  }
  .chip {
    min-height: 44px;
    padding: 0 12px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 15px;
  }
  .chip :global(.icon) {
    font-size: 12px;
  }
  .addition .chip {
    background: #ecf8f0;
  }
  .deduction .chip {
    background: var(--holiday);
  }
  .chip.custom {
    border-style: dashed;
    background: transparent;
    box-shadow: none;
  }
  .chip:disabled {
    opacity: 0.45;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--pencil);
  }
  .manage {
    margin-top: 10px;
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--blue-text);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
</style>
