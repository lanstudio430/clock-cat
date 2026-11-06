<script lang="ts">
  import { tick, untrack } from 'svelte';
  import mascot from '../assets/mascot.webp';
  import { DEFAULT_PROFILE_NAME, MAX_PROFILE_NAME, app } from '../lib/app-state.svelte';
  import type { RemoteUser } from '../lib/types';
  import Icon from './Icon.svelte';

  let dialog: HTMLDialogElement;
  // list：所有使用者；form：新增或修改一位（editingId 是 null 代表新增）
  let view = $state<'list' | 'form'>('form');
  let editingId = $state<string | null>(null);
  let name = $state('');
  let url = $state('');
  let key = $state('');
  let reveal = $state(false);
  let error = $state('');
  let confirmRemove = $state(false);

  // 管理員：在試算表建立使用者
  let creatingOpen = $state(false);
  let newName = $state('');
  let creating = $state(false);
  let createError = $state('');
  let created = $state<RemoteUser | null>(null);
  let remoteUsers = $state<RemoteUser[] | null>(null);
  let remoteError = $state('');

  const firstRun = $derived(app.profiles.length === 0);
  const editing = $derived(app.profiles.find((profile) => profile.id === editingId) ?? null);
  const isAdmin = $derived(app.profile?.admin === true);
  /** 試算表裡有、但還沒加到這台裝置的使用者，直接排在清單後面 */
  const notHere = $derived((remoteUsers ?? []).filter((user) => !app.hasProfile(app.settings?.url ?? '', user.key)));

  // 打開時：還沒有使用者就直接填連線；只有一位就直接改那一位；有好幾位先列出來
  // 只在打開的那一刻決定畫面；打開期間使用者清單變動（例如剛建立一位）不要重設
  $effect(() => {
    if (app.settingsOpen) {
      untrack(() => (app.profiles.length > 1 ? showList() : edit(app.profile?.id ?? null)));
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function edit(id: string | null) {
    const profile = app.profiles.find((item) => item.id === id) ?? null;
    editingId = profile?.id ?? null;
    name = profile?.name ?? (app.profiles.length ? '' : DEFAULT_PROFILE_NAME);
    // 新增使用者時先帶入目前的網址：同一個後端的其他使用者只要換密鑰
    url = profile?.url ?? app.settings?.url ?? '';
    key = profile?.key ?? '';
    reveal = false;
    error = '';
    confirmRemove = false;
    view = 'form';
  }

  function showList() {
    view = 'list';
    error = '';
    creatingOpen = false;
    createError = '';
    created = null;
    remoteError = '';
    // 管理員：順便問試算表裡還有誰沒加到這台裝置
    if (app.profile?.admin) void loadRemote();
  }

  async function openCreate() {
    creatingOpen = true;
    created = null;
    createError = '';
    await tick();
    document.getElementById('new-user-name')?.focus();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const wasActive = editingId !== null && editingId === app.profileId;
    error = app.saveProfile(editingId, name, url, key);
    // 修改其他使用者後回到清單；新增或修改目前的使用者時，App 會關掉設定
    if (!error && !wasActive && editingId !== null) showList();
  }

  function remove() {
    if (!editingId) return;
    if (!confirmRemove) {
      confirmRemove = true;
      return;
    }
    app.removeProfile(editingId);
    if (app.settingsOpen) showList();
  }

  async function createUser(event: SubmitEvent) {
    event.preventDefault();
    creating = true;
    createError = '';
    created = null;
    const result = await app.createRemoteUser(newName);
    creating = false;
    if ('error' in result) {
      createError = result.error;
    } else {
      created = result.user;
      newName = '';
      creatingOpen = false;
    }
  }

  async function loadRemote() {
    remoteError = '';
    const result = await app.listRemoteUsers();
    if ('error' in result) remoteError = result.error;
    else remoteUsers = result.users;
  }

</script>

<dialog bind:this={dialog} aria-labelledby="settings-title" onclose={() => app.closeSettings()}>
  <div class="hello" class:hidden={view === 'list'}>
    {#if firstRun}
      <p class="bubble">嗨！我是工時貓<br />先幫我連上你的試算表吧～</p>
    {/if}
    <div class="cat" style:background-image="url({mascot})" aria-hidden="true"></div>
  </div>

  <div class="card sticker">
    <span class="tape" style="left:18px;top:-12px;transform:rotate(-6deg)"></span>
    <h2 id="settings-title">使用者與連線設定</h2>
    {#if !firstRun}
      <button type="button" class="close" aria-label="關閉" onclick={() => app.closeSettings()}><Icon name="xmark" /></button>
    {/if}

    {#if view === 'list'}
      <ul class="people" aria-label="使用者">
        {#each app.profiles as profile (profile.id)}
          {@const pending = app.pendingCount(profile.id)}
          {@const current = profile.id === app.profileId}
          <li class:current>
            <button type="button" class="who" aria-current={current ? 'true' : undefined} onclick={() => app.switchProfile(profile.id)}>
              <span class="avatar" aria-hidden="true">{profile.name.slice(0, 1)}</span>
              <span class="who-text">
                <b>{profile.name}</b>
                {#if profile.admin || pending}
                  <small>{[profile.admin ? '管理員' : '', pending ? `${pending} 筆待同步` : ''].filter(Boolean).join('・')}</small>
                {/if}
              </span>
              {#if current}<Icon name="check" />{/if}
            </button>
            <button type="button" class="icon-btn" aria-label="編輯{profile.name}" onclick={() => edit(profile.id)}>
              <Icon name="pen" />
            </button>
          </li>
        {/each}
        {#each notHere as user (user.key)}
          <li class="elsewhere">
            <span class="who">
              <span class="avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
              <span class="who-text"><b>{user.name}</b><small>不在這台裝置</small></span>
            </span>
            <button type="button" class="join press" aria-label="加入{user.name}" onclick={() => app.addRemoteUser(user)}>加入</button>
          </li>
        {/each}
      </ul>
      {#if remoteError}
        <p class="error" role="alert"><Icon name="circleExclamation" />{remoteError}</p>
      {/if}

      {#if created}
        <p class="created" role="status">
          <Icon name="check" />已建立「{created.name}」
          {#if created.folder === null}<small>（留在雲端硬碟根目錄）</small>{/if}
          <a class="link" href={created.url} target="_blank" rel="noopener noreferrer"><Icon name="externalLink" />開啟試算表</a>
        </p>
      {/if}

      {#if creatingOpen}
        <form class="create" onsubmit={createUser} novalidate>
          <label class="visually-hidden" for="new-user-name">新使用者名稱</label>
          <input id="new-user-name" maxlength={MAX_PROFILE_NAME} placeholder="新使用者名稱" autocomplete="off" bind:value={newName} />
          <button type="submit" class="small-go press" disabled={creating}>
            {#if creating}<Icon name="circleNotch" />{/if}建立
          </button>
          <button type="button" class="icon-btn" aria-label="取消建立" onclick={() => (creatingOpen = false)}><Icon name="xmark" /></button>
        </form>
        {#if createError}
          <p class="error" role="alert"><Icon name="circleExclamation" />{createError}</p>
        {/if}
      {/if}

      <div class="add-row">
        {#if isAdmin && !creatingOpen}
          <button type="button" class="add" onclick={openCreate}><Icon name="userPlus" />建立新使用者</button>
        {/if}
        <button type="button" class="add" onclick={() => edit(null)}><Icon name="key" />用密鑰加入</button>
      </div>

      {#if !isAdmin && app.accountBackend === 'unsupported'}
        <p class="hint"><Icon name="circleInfo" />後端還沒更新到多使用者版本，重新部署後才能在這裡建立使用者。</p>
      {/if}
    {:else}
      <form onsubmit={submit} novalidate>
        {#if editingId !== null || firstRun}
          <p class="note">只存在這台裝置，換手機要再設定一次。</p>
        {/if}
        {#if app.configProblem && !error && (editingId === app.profileId || firstRun)}
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
            class:invalid={error.includes('網址')}
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

        <div class="field">
          <label class="label" for="settings-name"><b aria-hidden="true">3</b>名稱</label>
          <input
            id="settings-name"
            maxlength={MAX_PROFILE_NAME}
            autocomplete="off"
            placeholder="例如：小華"
            class:invalid={error.includes('名稱')}
            bind:value={name}
          />
        </div>

        {#if error}
          <p class="error" role="alert"><Icon name="circleExclamation" />{error}</p>
        {/if}

        <div class="actions">
          {#if !firstRun}
            <button type="button" class="cancel" onclick={() => (app.profiles.length > 1 || editingId === null ? showList() : app.closeSettings())}>
              {app.profiles.length > 1 || editingId === null ? '返回' : '取消'}
            </button>
          {/if}
          <button type="submit" class="go press"><Icon name="paw" />{firstRun ? '開始使用' : editingId === null ? '加入' : '儲存'}</button>
        </div>

        {#if editing && app.profiles.length > 1}
          <button type="button" class="remove" onclick={remove}>
            <Icon name="trashCan" />{confirmRemove ? `再按一次，從這台裝置移除${editing.name}` : '從這台裝置移除'}
          </button>
          {#if confirmRemove}<p class="fine">資料不會刪除，之後可以再加回來。</p>{/if}
        {/if}

        {#if !firstRun && editingId !== null && app.profiles.length === 1}
          <button type="button" class="more" onclick={showList}><Icon name="users" />多位使用者</button>
        {/if}
        <p class="fine">網址和密鑰怎麼拿？README 的安裝步驟有寫</p>
      </form>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100% - 32px));
    max-height: calc(100dvh - 24px);
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    color: inherit;
  }
  dialog[open] {
    overflow-y: auto;
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
  .problem,
  .hint {
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
  .hint {
    margin-top: 16px;
    background: var(--paper, #fff8ec);
    color: var(--pencil);
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
  .hello.hidden {
    display: none;
  }
  .card {
    position: relative;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 8px;
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    display: grid;
    place-items: center;
    font-size: 20px;
  }
  .people {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .people li {
    display: flex;
    align-items: center;
    border: 2px solid var(--ink);
    border-radius: 14px;
    background: var(--card);
  }
  .people li.current {
    background: var(--butter);
  }
  .people li.elsewhere {
    border-style: dashed;
    color: var(--pencil);
  }
  .who {
    flex: 1;
    min-width: 0;
    min-height: 52px;
    padding: 4px 8px;
    border: 0;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }
  .avatar {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--sky);
    display: grid;
    place-items: center;
    font-size: 15px;
  }
  .elsewhere .avatar {
    border-style: dashed;
    background: transparent;
  }
  .who-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .who-text b {
    font-size: 17px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who-text small {
    font-size: 13px;
    color: var(--pencil);
  }
  .icon-btn {
    flex: none;
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--pencil);
    display: grid;
    place-items: center;
  }
  .join {
    flex: none;
    height: 36px;
    margin-right: 8px;
    padding: 0 14px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--sky);
    font-size: 15px;
  }
  .add-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .add {
    flex: 1;
    min-height: 44px;
    padding: 0 8px;
    border: 2px dashed var(--ink);
    border-radius: 14px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 15px;
  }
  .more,
  .remove {
    width: 100%;
    min-height: 44px;
    margin-top: 10px;
    border: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 15px;
    color: var(--pencil);
  }
  .remove {
    color: var(--time);
  }
  .create {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
  }
  .create input {
    flex: 1;
    min-width: 0;
    margin-top: 0;
  }
  .small-go {
    flex: none;
    height: 48px;
    padding: 0 16px;
    border: 2.5px solid var(--ink);
    border-radius: 14px;
    background: var(--sky);
    box-shadow: var(--shadow-sm);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 16px;
  }
  .created {
    margin-top: 10px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--butter);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 15px;
  }
  .created small {
    color: var(--pencil);
  }
  .created .link {
    margin-left: auto;
  }
  .link {
    min-height: 32px;
    color: var(--ink);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    text-underline-offset: 3px;
  }
</style>
