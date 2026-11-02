<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/app-state.svelte';
  import Calendar from './components/Calendar.svelte';
  import Editor from './components/Editor.svelte';
  import ErrorCard from './components/ErrorCard.svelte';
  import Legend from './components/Legend.svelte';
  import MonthCard from './components/MonthCard.svelte';
  import MonthStrip from './components/MonthStrip.svelte';
  import Settings from './components/Settings.svelte';
  import Toast from './components/Toast.svelte';
  import TopBar from './components/TopBar.svelte';

  // 桌面版（≥ 1024px）：月份標籤在頂列中間，右側欄放本月卡；點日期時側欄換成編輯卡
  let desktop = $state(false);

  onMount(() => {
    const query = matchMedia('(min-width: 1024px)');
    const updateLayout = () => (desktop = query.matches);
    // 恢復連線或回到 App 時重新同步
    const online = () => void app.load({ quiet: true });
    const visible = () => document.visibilityState === 'visible' && app.refreshIfStale();

    updateLayout();
    query.addEventListener('change', updateLayout);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    app.start();

    return () => {
      query.removeEventListener('change', updateLayout);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  });
</script>

<div class="page" class:desktop>
  <header>
    <TopBar>
      {#if desktop}<MonthStrip />{/if}
    </TopBar>
  </header>
  {#if !desktop}
    <MonthStrip />
  {/if}

  <main>
    <div class="main-column">
      {#if !desktop}
        {#if app.showErrorCard}<ErrorCard />{:else}<MonthCard />{/if}
      {/if}
      <Calendar />
    </div>
    {#if desktop}
      <aside>
        {#if app.editing}
          {#key app.editing}<Editor mode="panel" />{/key}
        {:else}
          {#if app.showErrorCard}<ErrorCard />{:else}<MonthCard />{/if}
          <Legend />
        {/if}
      </aside>
    {/if}
  </main>
</div>

{#if !desktop && app.editing}
  {#key app.editing}<Editor mode="sheet" />{/key}
{/if}
<Settings />
<Toast />

<style>
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: max(12px, env(safe-area-inset-top)) 0 calc(90px + var(--safe-bottom));
  }
  header {
    padding: 0 16px;
  }
  main {
    padding: 0 16px;
  }
  .main-column {
    display: grid;
    gap: 22px;
    margin-top: 6px;
  }
  .desktop {
    max-width: 1240px;
    padding: 24px 26px 60px;
  }
  .desktop header {
    padding: 0;
  }
  .desktop header :global(.strip) {
    flex: 1;
    min-width: 0;
    margin: 0 12px;
  }
  .desktop main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 370px;
    gap: 26px;
    align-items: start;
    padding: 0;
    margin-top: 22px;
  }
  .desktop .main-column {
    margin-top: 0;
  }
  aside {
    position: sticky;
    top: 16px;
    display: grid;
    gap: 22px;
    padding-top: 14px;
  }

  @media (min-width: 768px) {
    .page:not(.desktop) {
      max-width: 860px;
    }
  }
</style>
