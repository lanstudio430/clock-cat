<script lang="ts">
  import Icon from './Icon.svelte';
</script>

<section class="legend sticker" aria-label="圖例">
  <span class="tape butter" style="right:18px;top:-12px;transform:rotate(6deg)"></span>
  <h2>圖例</h2>
  <ul>
    <li><span class="dot" style:background="var(--off-tag)"><Icon name="moon" /></span>例假</li>
    <li><span class="dot" style:background="var(--off-tag)"><Icon name="mugHot" /></span>休假</li>
    <li><span class="dot" style:background="var(--holiday-tag)"><Icon name="flag" /></span>國定假日</li>
    <li><span class="dot today" style:background="var(--sky)"><Icon name="paw" /></span>今天</li>
  </ul>
  <p>紅字是當天的上下班時間；有填實際就顯示實際，沒填就顯示原定。</p>
</section>

<style>
  .legend {
    padding: 16px;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 17px;
    font-weight: 400;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
    font-size: 15px;
  }
  li {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .dot {
    width: 26px;
    height: 26px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
  }
  .today {
    color: var(--coral);
  }
  p {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--pencil);
  }
</style>
