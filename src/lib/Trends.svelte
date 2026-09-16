<script lang="ts">
  import { appState } from "./appState.svelte";
  import { computeDailyStats, summarize } from "./trends";

  let { onBack }: { onBack: () => void } = $props();

  let stats7 = $derived(computeDailyStats(appState.selectedSessions, 7));
  let stats14 = $derived(computeDailyStats(appState.selectedSessions, 14));
  let summary = $derived(summarize(stats7));

  let maxBar = $derived(Math.max(1, ...stats14.map((s) => s.totalMinutes / 60)));

  function fmt(n: number | null, unit: string): string {
    return n === null ? "—" : `${n.toFixed(1)} ${unit}`;
  }
</script>

<div class="trends">
  <header>
    <button class="btn-icon" aria-label="Back" onclick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <h1>Trends</h1>
  </header>

  {#if !appState.selectedChild}
    <p class="muted">Add a child to see trends.</p>
  {:else}
    <div class="pills">
      {#each appState.children as child (child.id)}
        <button
          class="pill {child.id === appState.selectedChildId ? 'active' : ''}"
          onclick={() => appState.selectChild(child.id)}
        >
          {child.name}
        </button>
      {/each}
    </div>

    <section class="card stats">
      <div class="stat">
        <span class="muted small">Avg total sleep/day this week</span>
        <span class="value">{fmt(summary.avgTotalHours, "hrs")}</span>
      </div>
      <div class="stat">
        <span class="muted small">Avg longest stretch this week</span>
        <span class="value">{fmt(summary.avgLongestHours, "hrs")}</span>
      </div>
      <div class="stat">
        <span class="muted small">Avg sleep sessions/day this week</span>
        <span class="value">{fmt(summary.avgSessionsPerDay, "")}</span>
      </div>
    </section>

    <section class="card">
      <span class="muted small">Total sleep, last 14 days</span>
      <div class="sparkline">
        {#each stats14 as day (day.dateKey)}
          <div class="bar-wrap" title="{day.dateKey}: {(day.totalMinutes / 60).toFixed(1)}h">
            <div class="bar" style="height: {(day.totalMinutes / 60 / maxBar) * 100}%"></div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .trends {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .pills {
    display: flex;
    gap: 8px;
  }
  .stats {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .stat {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .value {
    font-weight: 700;
    font-size: 1.1rem;
  }
  .sparkline {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 70px;
    margin-top: 10px;
  }
  .bar-wrap {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    width: 100%;
    min-height: 2px;
    background: var(--accent);
    border-radius: 3px 3px 0 0;
  }
</style>
