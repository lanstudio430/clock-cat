<script lang="ts">
  import mascot from '../assets/mascot.webp';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';

  let dialog: HTMLDialogElement;
  let url = $state('');
  let key = $state('');
  let reveal = $state(false);
  let error = $state('');
  const firstRun = $derived(!app.isConfigured);

  // 打開時帶入目前的設定；用原生 dialog，焦點鎖定與 Esc 關閉都由瀏覽器處理
  $effect(() => {
    if (app.settingsOpen) {
      url = app.settings?.url ?? '';
      key = app.settings?.key ?? '';
      reveal = false;
      error = '';
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    error = app.saveSettings(url, key);
  }
</script>

<dialog bind:this={dialog} aria-labelledby="settings-title" onclose={() => app.closeSettings()}>
  <div class="hello">
    {#if firstRun}
      <p class="bubble">嗨！我是工時貓<br />先幫我連上你的試算表吧～</p>
    {/if}
    <div class="cat" style:background-image="url({mascot})" aria-hidden="true"></div>
  </div>

  <form class="card sticker" onsubmit={submit} novalidate>
    <span class="tape" style="left:18px;top:-12px;transform:rotate(-6deg)"></span>
    <h2 id="settings-title">連線設定</h2>
    <p class="note">只存在這台裝置，換手機要再設定一次。</p>
    {#if app.configProblem && !error}
      <p class="problem"><Icon name="triangleExclamation" />目前的問題：{app.configProblem}</p>
    {/if}

    <div class="field">
      <label class="label" for="settings-url"><b aria-hidden="true">1</b>Apps Script 網址</label>
      <input
        id="settings-url"
        type="url"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://script.google.com/macros/s/…/exec"
        class:invalid={error && !error.includes('密鑰')}
        bind:value={url}
      />
    </div>

    <div class="field">
      <label class="label" for="settings-key"><b aria-hidden="true">2</b>密鑰</label>
      <span class="key" class:invalid={error.includes('密鑰')}>
        {#if reveal}
          <input id="settings-key" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={key} />
        {:else}
          <input id="settings-key" type="password" autocomplete="off" bind:value={key} />
        {/if}
        <button type="button" class="eye" aria-label={reveal ? '隱藏密鑰' : '顯示密鑰'} onclick={() => (reveal = !reveal)}>
          <Icon name={reveal ? 'eyeSlash' : 'eye'} />
        </button>
      </span>
    </div>

    {#if error}
      <p class="error" role="alert"><Icon name="circleExclamation" />{error}</p>
    {/if}

    <div class="actions">
      {#if !firstRun}
        <button type="button" class="cancel" onclick={() => app.closeSettings()}>取消</button>
      {/if}
      <button type="submit" class="go press"><Icon name="paw" />{firstRun ? '開始使用' : '儲存'}</button>
    </div>
    <p class="fine">網址和密鑰怎麼拿？README 的安裝步驟有寫</p>
  </form>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100% - 32px));
    max-height: calc(100dvh - 24px);
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    color: inherit;
  }
  dialog::backdrop {
    background: rgba(69, 43, 51, 0.45);
  }
  .hello {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .bubble {
    position: relative;
    margin: 0 0 14px;
    padding: 10px 18px;
    border: 2.5px solid var(--ink);
    border-radius: 18px;
    background: var(--card);
    box-shadow: var(--shadow);
    font-size: 18px;
    line-height: 1.4;
    text-align: center;
  }
  .bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -11px;
    width: 18px;
    height: 18px;
    background: var(--card);
    border-right: 2.5px solid var(--ink);
    border-bottom: 2.5px solid var(--ink);
    transform: translateX(-50%) rotate(45deg);
  }
  .cat {
    width: 120px;
    height: 126px;
    margin-bottom: -18px;
    background-repeat: no-repeat;
    background-position: 50% 0;
    background-size: 120px auto;
  }
  .card {
    padding: 20px 16px 16px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 24px;
    font-weight: 400;
  }
  p {
    margin: 0;
  }
  .note,
  .fine {
    font-size: 14px;
    color: var(--pencil);
  }
  .fine {
    margin-top: 12px;
    text-align: center;
    font-size: 13px;
  }
  .problem {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--holiday);
    color: var(--time);
    font-size: 14px;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .field {
    display: block;
    margin-top: 14px;
  }
  .label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 16px;
  }
  .label b {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--butter);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 900;
  }
  input {
    width: 100%;
    height: 48px;
    margin-top: 6px;
    padding: 0 12px;
    border: 2.5px solid var(--ink);
    border-radius: 14px;
    background: var(--card);
    font-size: 16px;
    font-weight: 700;
  }
  input::placeholder {
    color: var(--faint);
    font-weight: 400;
  }
  input.invalid,
  .key.invalid input {
    border-color: var(--time);
    background: #fff6f5;
  }
  .key {
    position: relative;
    display: block;
  }
  .key input {
    padding-right: 52px;
  }
  .eye {
    position: absolute;
    right: 4px;
    bottom: 2px;
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    display: grid;
    place-items: center;
    font-size: 18px;
  }
  .error {
    margin-top: 10px;
    font-size: 14px;
    color: var(--time);
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 18px;
  }
  .cancel {
    min-height: 44px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    font-size: 16px;
  }
  .go {
    flex: 1;
    height: 54px;
    border: 2.5px solid var(--ink);
    border-radius: 16px;
    background: var(--sky);
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 20px;
  }
  .go :global(.icon) {
    color: var(--coral);
  }
</style>
