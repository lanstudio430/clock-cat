<script lang="ts">
  import { app } from '../lib/app-state.svelte';
  import { formatNumber } from '../lib/calc';
  import { formatHourly, formatMoney, minimumWage, type PayLine } from '../lib/pay';
  import Icon from './Icon.svelte';

  const resolved = $derived(app.payResolved);
  const pay = $derived(app.pay);
  const minimum = $derived(minimumWage(app.monthKey));
  const month = $derived(`${app.month + 1} 月`);

  // 金額設成「不進位」時，每一行都顯示兩位小數，位數才會一樣
  const fixed = $derived(resolved?.pay.payRounding === 'none');
  const fmt = (value: number) => formatMoney(value, fixed);

  // 時薪是怎麼來的，寫清楚讓人能對照薪資單
  const hourlyNote = $derived.by(() => {
    if (!resolved || !pay) return '';
    if (resolved.pay.jobType === 'parttime') return `時薪 ${formatMoney(pay.hourly)}`;
    const how = { none: '不進位，用完整的數字去乘', round: '四捨五入', ceil: '無條件進位' }[resolved.pay.rounding];
    return `時薪 ${formatHourly(pay.hourly)} 元（本薪 ÷ 30 ÷ 8，${how}）`;
  });

  const amountNote = $derived(
    resolved ? `每一行金額：${{ none: '不進位，保留到小數第二位', round: '四捨五入到整數', ceil: '無條件進位到整數' }[resolved.pay.payRounding]}` : '',
  );

  // 工讀生時薪低於基本工資時提醒；正職月薪低於基本工資也提醒
  const belowMinimum = $derived.by(() => {
    if (!resolved) return '';
    const settings = resolved.pay;
    if (settings.jobType === 'parttime' && settings.hourlyWage < minimum.hourly) {
      return `時薪 ${settings.hourlyWage} 元低於 ${minimum.year} 年基本工資時薪 ${minimum.hourly} 元`;
    }
    if (settings.jobType === 'fulltime' && settings.baseSalary < minimum.monthly) {
      return `本薪低於 ${minimum.year} 年基本工資月薪 ${formatMoney(minimum.monthly)}`;
    }
    return '';
  });
</script>

{#snippet row(item: PayLine, negative: boolean)}
  <li data-testid="pay-line" data-key={item.key} class:negative>
    <span class="name">
      {item.label}
      {#if item.detail}<small>{item.detail}</small>{/if}
    </span>
    <i aria-hidden="true"></i>
    <b>{negative ? '-' : ''}{fmt(item.amount)}</b>
  </li>
{/snippet}

{#if !resolved}
  <section class="card sticker cta" aria-label="薪資試算">
    <span class="tape butter" style="right:20px;top:-12px;transform:rotate(5deg)"></span>
    <Icon name="sackDollar" />
    <div>
      <h2>{month}還沒有薪資設定</h2>
      <p>設定本薪、加項與扣項，我幫你算加班費和預估實領薪資。</p>
      <div class="buttons">
        <button type="button" class="primary press" onclick={() => app.openPayDialog()}><Icon name="coins" />設定這個月</button>
        <button type="button" class="secondary press" onclick={() => app.openCategories()}>常用類別</button>
      </div>
    </div>
  </section>
{:else}
  <section class="card sticker" aria-label="{month}薪資試算">
    <span class="tape butter" style="right:20px;top:-12px;transform:rotate(5deg)"></span>
    <header>
      <h2><Icon name="sackDollar" />{month}薪資試算</h2>
      <div class="buttons">
        <button type="button" class="primary press" onclick={() => app.openPayDialog()}><Icon name="gear" />編輯本月</button>
        <button type="button" class="secondary press" onclick={() => app.openCategories()}>常用類別</button>
      </div>
    </header>

    {#if resolved.source === 'inherited'}
      <p class="inherit" data-testid="inherit-note"><Icon name="circleInfo" />沿用 {Number(resolved.from.slice(5))} 月的設定</p>
    {/if}

    <div class="net">
      <span>預估實領</span>
      <strong data-testid="net-pay">{pay ? fmt(pay.net) : '–'}</strong>
    </div>

    {#if pay}
      <section class="block addition" aria-label="加項">
        <h3>
          <span class="sign"><Icon name="plus" /></span>加項
          <b data-testid="addition-total">{fmt(pay.additionTotal)}</b>
        </h3>
        <ul>
          {#each pay.additions as item (item.key)}{@render row(item, false)}{/each}
        </ul>
      </section>

      <section class="block deduction" aria-label="扣項">
        <h3>
          <span class="sign"><Icon name="minus" /></span>扣項
          <b data-testid="deduction-total">{pay.deductions.length ? '-' : ''}{fmt(pay.deductionTotal)}</b>
        </h3>
        {#if pay.deductions.length}
          <ul>
            {#each pay.deductions as item (item.key)}{@render row(item, true)}{/each}
          </ul>
        {:else}
          <p class="none">這個月沒有扣項</p>
        {/if}
      </section>

      <ul class="notes">
        {#if pay.jobType === 'fulltime' && pay.requiredMissing}
          <li><Icon name="circleInfo" />填上應上班時數，才能算加班費</li>
        {:else if pay.shortfallHours > 0}
          <li><Icon name="circleInfo" />還差 {formatNumber(pay.shortfallHours)} 小時才達到應上班時數，超過的部分才算加班費</li>
        {/if}
        {#if hourlyNote}<li><Icon name="circleInfo" />{hourlyNote}</li>{/if}
        {#if amountNote}<li><Icon name="circleInfo" />{amountNote}</li>{/if}
        {#if belowMinimum}<li class="warn"><Icon name="triangleExclamation" />{belowMinimum}</li>{/if}
        {#if app.payBackend === 'unsupported'}
          <li class="warn"><Icon name="triangleExclamation" />後端還沒更新，薪資設定只存在這台裝置</li>
        {/if}
      </ul>
    {:else}
      <p class="loading">讀取班表中…</p>
    {/if}
    <p class="disclaimer">試算僅供參考，實際金額以公司薪資單為準。</p>
  </section>
{/if}

<style>
  .card {
    padding: 22px 16px 14px;
  }
  .cta {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .cta > :global(.icon) {
    flex: none;
    font-size: 44px;
    color: var(--coral);
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 400;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  h2 :global(.icon) {
    color: var(--coral);
  }
  .cta p {
    margin: 4px 0 12px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--pencil);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary,
  .secondary {
    min-height: 44px;
    padding: 0 14px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 15px;
  }
  .primary {
    background: var(--sky);
  }
  .inherit {
    margin: 10px 0 0;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--sky-soft);
    font-size: 13.5px;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .inherit :global(.icon) {
    color: var(--blue-text);
  }
  .net {
    margin: 12px 0 14px;
    padding: 10px 14px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    background: var(--butter);
    box-shadow: var(--shadow);
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .net span {
    font-size: 15px;
  }
  .net strong {
    font-size: 30px;
    font-weight: 900;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .block {
    margin-top: 12px;
    padding: 10px 12px 12px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
  }
  .addition {
    border-color: var(--green-text);
    background: #f6fbf8;
  }
  .deduction {
    border-color: var(--time);
    background: #fff7f6;
  }
  h3 {
    margin: 0 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 17px;
    font-weight: 400;
  }
  h3 b {
    margin-left: auto;
    font-size: 19px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .addition h3 b {
    color: var(--green-text);
  }
  .deduction h3 b {
    color: var(--time);
  }
  .sign {
    width: 26px;
    height: 26px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--card);
  }
  .addition .sign {
    background: var(--green-text);
  }
  .deduction .sign {
    background: var(--time);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 15px;
  }
  .name {
    flex: 0 1 auto;
    min-width: 0;
  }
  .name small {
    display: block;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--pencil);
  }
  li > i {
    flex: 1;
    min-width: 12px;
    align-self: flex-start;
    margin-top: 0.85em;
    border-bottom: 2.5px dotted var(--faint);
  }
  li > b {
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  li.negative > b {
    color: var(--time);
  }
  .none {
    margin: 0;
    font-size: 14px;
    color: var(--pencil);
  }
  .notes {
    margin-top: 14px;
    gap: 6px;
  }
  .notes li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 13px;
    line-height: 1.4;
    color: var(--pencil);
  }
  .notes :global(.icon) {
    color: var(--blue-text);
  }
  .notes .warn {
    color: var(--time);
  }
  .notes .warn :global(.icon) {
    color: var(--time);
  }
  .loading,
  .disclaimer {
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--pencil);
  }
  .disclaimer {
    padding-top: 10px;
    border-top: 2px dotted var(--faint);
  }
</style>
