<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/app-state.svelte';
  import Icon from './Icon.svelte';

  // 跨年連續的月份標籤：前後各 12 個月，每年 1 月前面插一個年份分隔
  const SPAN = 12;
  const DRAG_THRESHOLD = 5;
  const chips = $derived(
    Array.from({ length: SPAN * 2 + 1 }, (_, i) => {
      const date = new Date(app.year, app.month - SPAN + i, 1);
      return { year: date.getFullYear(), month: date.getMonth(), selected: i === SPAN };
    }),
  );

  let strip: HTMLElement;
  let first = true;
  let dragging = $state(false);

  // 換月份時，月份列會以新的月份重建前後 12 個月，左邊的標籤數量一變，內容就整個位移。
  // 所以先記住原本選中的標籤在畫面上的位置，重建後先把它補回原處，再平滑捲到中間
  let anchor: { label: string | null; x: number } | null = null;

  $effect.pre(() => {
    app.monthKey;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="date"]');
    anchor = chip ? { label: chip.getAttribute('aria-label'), x: chip.getBoundingClientRect().left - strip.getBoundingClientRect().left } : null;
  });

  // 選中的月份捲到中間；第一次直接定位，之後平滑捲動
  $effect(() => {
    app.monthKey;
    tick().then(() => {
      const chip = strip?.querySelector<HTMLElement>('[aria-current="date"]');
      if (!chip) return;
      const stripLeft = strip.getBoundingClientRect().left;
      const old = anchor && [...strip.querySelectorAll<HTMLElement>('.chip')].find((node) => node.getAttribute('aria-label') === anchor!.label);
      if (old && anchor) strip.scrollLeft += old.getBoundingClientRect().left - stripLeft - anchor.x;
      // 不能用 offsetLeft：它是相對於最近的定位祖先，不是月份列，桌面版左邊有 logo 就會算錯
      const rect = chip.getBoundingClientRect();
      const left = strip.scrollLeft + rect.left - strip.getBoundingClientRect().left - strip.clientWidth / 2 + rect.width / 2;
      strip.scrollTo({ left, behavior: first ? 'instant' : 'smooth' });
      first = false;
    });
  });

  // 滑鼠滾輪是上下捲動，在月份列上改成左右捲動；列本來就放得下時不攔截
  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollBy({ left: event.deltaY });
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  });

  // 滑鼠按住拖曳；手指本來就能滑，不處理。拖超過幾個像素才算拖曳，之後那一下不要當成點擊
  let drag: { x: number; left: number; moved: boolean } | null = null;

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, left: strip.scrollLeft, moved: false };
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag) return;
    const distance = event.clientX - drag.x;
    if (!drag.moved && Math.abs(distance) < DRAG_THRESHOLD) return;
    drag.moved = true;
    dragging = true;
    strip.scrollLeft = drag.left - distance;
  }

  function endDrag() {
    dragging = false;
    // 放開後的 click 事件還會送出，這一次要略過
    if (drag?.moved) setTimeout(() => (drag = null), 0);
    else drag = null;
  }

  function onClickCapture(event: MouseEvent) {
    if (drag?.moved) {
      event.stopPropagation();
      event.preventDefault();
    }
  }

  const step = (delta: number) => app.goTo(app.year, app.month + delta);
</script>

<div class="months">
  <button type="button" class="arrow press" aria-label="上個月" onclick={() => step(-1)}><Icon name="chevronLeft" /></button>
  <nav
    class="strip"
    class:dragging
    bind:this={strip}
    aria-label="月份"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onpointerleave={endDrag}
    onclickcapture={onClickCapture}
  >
    {#each chips as chip (`${chip.year}-${chip.month}`)}
      {#if chip.month === 0}
        <span class="divider" aria-hidden="true">{chip.year}</span>
      {/if}
      <button
        type="button"
        class="chip"
        class:selected={chip.selected}
        aria-current={chip.selected ? 'date' : undefined}
        aria-label="{chip.year} 年 {chip.month + 1} 月"
        onclick={() => app.goTo(chip.year, chip.month)}
      >
        <b>{chip.month + 1}</b>月
      </button>
    {/each}
  </nav>
  <button type="button" class="arrow press" aria-label="下個月" onclick={() => step(1)}><Icon name="chevronRight" /></button>
</div>

<style>
  .months {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  /* 左右箭頭只在有滑鼠的裝置上出現；手機直接用手指滑 */
  .arrow {
    display: none;
    flex: none;
    width: 44px;
    height: 44px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    place-items: center;
    font-size: 16px;
  }
  @media (hover: hover) and (pointer: fine) {
    .arrow {
      display: grid;
    }
    .strip {
      cursor: grab;
    }
  }
  .strip.dragging {
    cursor: grabbing;
    user-select: none;
  }
  .strip {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    overflow-x: auto;
    padding: 8px 16px 12px;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent);
    mask-image: linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent);
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    height: 44px;
    min-width: 52px;
    padding: 0 9px;
    border-radius: 13px;
    border: 2px dashed var(--faint);
    background: transparent;
    color: var(--pencil);
    font-size: 16px;
    white-space: nowrap;
  }
  .chip b {
    font-weight: 900;
  }
  .chip:hover {
    border-color: var(--pencil);
  }
  .selected {
    height: 50px;
    min-width: 72px;
    background: var(--sky);
    border: 2.5px solid var(--ink);
    color: var(--ink);
    box-shadow: var(--shadow);
    transform: rotate(-3deg);
    font-size: 21px;
  }
  .divider {
    flex: none;
    height: 28px;
    padding: 0 9px;
    border: 2px solid var(--blue-text);
    border-radius: 999px;
    background: var(--card);
    color: var(--blue-text);
    font-size: 13px;
    font-weight: 900;
    display: grid;
    place-items: center;
  }
</style>
