<script lang="ts">
  import type { TimelineSegment } from "./timeline";

  let { segments }: { segments: TimelineSegment[] } = $props();
</script>

<div class="bar">
  {#each segments as seg, i (i)}
    <div class="seg {seg.type}" style="width: {seg.widthFraction * 100}%"></div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    height: 14px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .seg {
    height: 100%;
  }
  .seg.asleep {
    background: var(--asleep);
  }
  .seg.awake {
    background: var(--awake);
    opacity: 0.55;
  }
</style>
