<script lang="ts">
  import { icons, type IconName } from '../lib/icons';

  let { name, label = '', spin = false }: { name: IconName; label?: string; spin?: boolean } = $props();
</script>

<span class="icon" class:spin role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
  {@html icons[name]}
</span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
    width: 1em;
    height: 1em;
    vertical-align: -0.125em;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
  .spin {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
