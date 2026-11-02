<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { app } from '../lib/app-state.svelte';
  import { MAX_CATEGORIES, blankCategory, defaultCatalog } from '../lib/pay';
  import type { ItemSide, PayCatalog } from '../lib/types';
  import AmountField from './AmountField.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let draft = $state<PayCatalog>(defaultCatalog());
  let error = $state('');

  // 打開時才取一份草稿，按儲存才寫回
  $effect(() => {
    if (!app.categoriesOpen) return;
    draft = untrack(() => structuredClone($state.snapshot(app.catalog)));
    error = '';
  });

  const SIDES: { side: ItemSide; title: string; hint: string }[] = [
    { side: 'addition', title: '加項', hint: '例如津貼、獎金、加給' },
    { side: 'deduction', title: '扣項', hint: '例如勞保費、健保費、職工福利金' },
  ];

  async function add(side: ItemSide) {
    const category = blankCategory(side);
    draft.categories.push(category);
    await tick();
    document.getElementById(`category-name-${category.id}`)?.focus();
  }

  function remove(id: string) {
    draft.categories = draft.categories.filter((category) => category.id !== id);
  }
</script>

<Modal
  open={app.categoriesOpen}
  title="常用類別"
  titleId="categories-title"
  icon="coins"
  onclose={() => app.closeCategories()}
  onsubmit={() => (error = app.saveCatalog(draft))}
>
  <p class="intro">
    <Icon name="circleInfo" />
    這裡的類別會出現在每月薪資設定的「快速加入」，點一下就帶入名稱和預設的金額或比例。每個月特別的項目，直接在月份的薪資設定裡自訂就好。
  </p>

  {#each SIDES as { side, title, hint } (side)}
    {@const list = draft.categories.filter((category) => category.side === side)}
    <section class="side" class:addition={side === 'addition'} class:deduction={side === 'deduction'} aria-label="常用{title}">
      <h3>
        <span class="sign"><Icon name={side === 'addition' ? 'plus' : 'minus'} /></span>常用{title}
        <small>{hint}</small>
      </h3>
      <ul>
        {#each list as category, index (category.id)}
          <li class="row">
            <div class="line">
              <input
                id="category-name-{category.id}"
                class="name"
                type="text"
                aria-label="常用{title} {index + 1} 的名稱"
                placeholder="類別名稱"
                maxlength="20"
                bind:value={category.name}
              />
              <button type="button" class="trash press" aria-label="刪除常用{title} {index + 1}" onclick={() => remove(category.id)}>
                <Icon name="trashCan" />
              </button>
            </div>
            <div class="line">
              <AmountField
                bind:mode={category.mode}
                bind:value={category.value}
                label="常用{title} {index + 1} 預設的{category.mode === 'percent' ? '比例' : '金額'}"
                unitLabel="常用{title} {index + 1} 預設"
              />
            </div>
          </li>
        {/each}
      </ul>
      <button type="button" class="add press" disabled={draft.categories.length >= MAX_CATEGORIES} onclick={() => add(side)}>
        <Icon name="plus" />新增常用{title}
      </button>
    </section>
  {/each}

  <button type="button" class="restore" onclick={() => (draft = defaultCatalog())}>還原成預設的類別</button>

  {#snippet footer()}
    {#if error}
      <p class="error" role="alert"><Icon name="circleExclamation" />{error}</p>
    {/if}
    <div class="actions">
      <button type="button" class="cancel" onclick={() => app.closeCategories()}>取消</button>
      <button type="submit" class="save press"><Icon name="paw" />儲存</button>
    </div>
  {/snippet}
</Modal>

<style>
  .intro {
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
  .intro :global(.icon) {
    color: var(--blue-text);
    flex: none;
  }
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
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 18px;
    font-weight: 400;
  }
  h3 small {
    flex-basis: 100%;
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
  ul {
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
  .add {
    min-height: 44px;
    width: 100%;
    padding: 0 14px;
    border: 2px dashed var(--ink);
    border-radius: 12px;
    background: transparent;
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    font-size: 15px;
  }
  .add:disabled {
    opacity: 0.45;
  }
  .restore {
    justify-self: start;
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--blue-text);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 4px;
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
  .cancel {
    margin-left: auto;
    min-height: 44px;
    padding: 0 10px;
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
