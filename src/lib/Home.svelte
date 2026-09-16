<script lang="ts">
  import { appState } from "./appState.svelte";
  import { startSleepSession, endSleepSession, getRunningSession, getOverride } from "./db";
  import { predictNextSleep, type SweetSpotPrediction } from "./prediction";
  import { buildDayTimeline, todayKey } from "./timeline";
  import TimelineBar from "./TimelineBar.svelte";
  import { fullSync } from "./sync";
  import type { SleepSlot } from "./types";

  let {
    onOpenTrends,
    onOpenSettings,
    onOpenDay,
    onAddPastSleep,
  }: {
    onOpenTrends: () => void;
    onOpenSettings: () => void;
    onOpenDay: (dateKey: string) => void;
    onAddPastSleep: () => void;
  } = $props();

  let now = $state(new Date());
  let overrides = $state<Map<SleepSlot, number>>(new Map());
  let toggling = $state(false);

  $effect(() => {
    const interval = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    const childId = appState.selectedChildId;
    if (!childId) return;
    (async () => {
      const slots: SleepSlot[] = ["nap1", "nap2", "nap3", "bedtime"];
      const map = new Map<SleepSlot, number>();
      for (const slot of slots) {
        const o = await getOverride(childId, slot);
        if (o) map.set(slot, o.wakeWindowMinutes);
      }
      overrides = map;
    })();
  });

  let runningSession = $derived(appState.selectedSessions.find((s) => s.endTime === null) ?? null);

  let prediction = $derived.by((): SweetSpotPrediction | null => {
    if (!appState.selectedChild || runningSession) return null;
    return predictNextSleep(appState.selectedChild, appState.selectedSessions, overrides, now);
  });

  let countdownText = $derived.by(() => {
    if (!prediction) return null;
    const diffMs = prediction.predictedTime.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin <= 0) return "now";
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

  let elapsedAsleepText = $derived.by(() => {
    if (!runningSession) return null;
    const diffMin = Math.round((now.getTime() - new Date(runningSession.startTime).getTime()) / 60000);
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

  let timeline = $derived(
    appState.selectedChildId ? buildDayTimeline(todayKey(now), appState.selectedSessions, now) : [],
  );

  function isAsleep(childId: string): boolean {
    return (appState.sessionsByChild[childId] ?? []).some((s) => s.endTime === null);
  }

  async function toggleSleep() {
    if (!appState.selectedChildId || toggling) return;
    toggling = true;
    const childId = appState.selectedChildId;
    const running = await getRunningSession(childId);
    if (running) {
      await endSleepSession(running.id);
    } else {
      await startSleepSession(childId);
    }
    await appState.loadSessions(childId);
    toggling = false;
    fullSync().catch(() => {});
  }

  function formatTime(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
</script>

<div class="home">
  <header>
    <div class="pills">
      {#each appState.children as child (child.id)}
        <button
          class="pill {child.id === appState.selectedChildId ? 'active' : ''}"
          onclick={() => appState.selectChild(child.id)}
        >
          <span class="status-dot {isAsleep(child.id) ? 'asleep' : 'awake'}"></span>
          {child.name}
        </button>
      {/each}
    </div>
    <div class="icon-row">
      <button class="btn-icon" aria-label="Trends" onclick={onOpenTrends}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19V10M12 19V5M20 19v-7" stroke-linecap="round" />
        </svg>
      </button>
      <button class="btn-icon" aria-label="Settings" onclick={onOpenSettings}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
          />
        </svg>
      </button>
    </div>
  </header>

  {#if !appState.selectedChild}
    <p class="muted">Add a child to get started.</p>
  {:else}
    <div class="sweetspot card">
      {#if runningSession}
        <div class="label muted">Asleep for</div>
        <div class="big">{elapsedAsleepText}</div>
        <div class="muted small">since {formatTime(new Date(runningSession.startTime))}</div>
      {:else if prediction}
        <div class="label muted">Next SweetSpot</div>
        <div class="big">{formatTime(prediction.predictedTime)}</div>
        <div class="muted small">in {countdownText}</div>
      {:else}
        <div class="label muted">Next SweetSpot</div>
        <div class="big faint">—</div>
      {/if}
    </div>

    <div class="main-action">
      <button
        class="btn-primary {runningSession ? 'active' : ''}"
        disabled={toggling}
        onclick={toggleSleep}
      >
        {runningSession ? "Wake Up" : "Log Sleep"}
      </button>
      <button class="btn-icon" aria-label="Add past sleep" onclick={onAddPastSleep}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <button class="timeline-wrap" onclick={() => onOpenDay(todayKey(now))}>
      <TimelineBar segments={timeline} />
      <div class="muted small">Today · tap to review</div>
    </button>
  {/if}
</div>

<style>
  .home {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pills {
    display: flex;
    gap: 8px;
  }
  .icon-row {
    display: flex;
    gap: 8px;
  }
  .sweetspot {
    text-align: center;
    padding: 28px 16px;
  }
  .label {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .big {
    font-size: 2.6rem;
    font-weight: 700;
    line-height: 1.2;
    margin: 4px 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .main-action {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .main-action .btn-primary {
    flex: 1;
    text-align: center;
  }
  .main-action .btn-primary:disabled {
    opacity: 0.6;
  }
  .timeline-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: transparent;
    padding: 0;
    text-align: left;
  }
</style>
