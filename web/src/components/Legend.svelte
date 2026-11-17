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
    <li><span class="dot" style:background="var(--personal-leave-tag)"><Icon name="fileSignature" /></span>事假</li>
    <li><span class="dot" style:background="var(--sick-leave-tag)"><Icon name="kitMedical" /></span>病假</li>
    <li><span class="dot today"><Icon name="paw" /></span>今天</li>
  </ul>
  <p>格子裡是當天的上下班時間：深綠色是實際時間，紅字是原定時間。</p>
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
  /* 跟日曆上的今天一樣：珊瑚色框、不填底色 */
  .today {
    border-color: var(--coral);
    background: var(--card);
    color: var(--coral);
  }
  p {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--pencil);
  }
</style>
