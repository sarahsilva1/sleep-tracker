<script lang="ts">
  import { appState } from "./appState.svelte";
  import { startSleepSession, endSleepSession, getRunningSession, updateSleepSession } from "./db";
  import { predictWindDown, predictEstimatedWake, type WindDownPrediction, type EstimatedWakeRange } from "./prediction";
  import { buildDayTimeline, todayKey } from "./timeline";
  import TimelineBar from "./TimelineBar.svelte";
  import { fullSync } from "./sync";
  import { timeAwareGreeting } from "./greeting";

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
  let toggling = $state(false);
  let confirmMessage = $state("");
  let editingStart = $state(false);
  let editStartValue = $state("");

  $effect(() => {
    const interval = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(interval);
  });

  let runningSession = $derived(appState.selectedSessions.find((s) => s.endTime === null) ?? null);

  let windDown = $derived.by((): WindDownPrediction | null => {
    if (!appState.selectedChild || runningSession) return null;
    return predictWindDown(appState.selectedChild, appState.selectedSessions, now);
  });

  let estimatedWake = $derived.by((): EstimatedWakeRange | null => {
    if (!appState.selectedChild || !runningSession) return null;
    return predictEstimatedWake(appState.selectedChild, appState.selectedSessions, now);
  });

  function formatDurationWords(totalMinutes: number): string {
    const mins = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
    if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
    return `${h}h ${m}m`;
  }

  function formatTime(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  let windDownPhrase = $derived.by(() => {
    if (!windDown) return null;
    const diffMin = (windDown.predictedTime.getTime() - now.getTime()) / 60000;
    if (diffMin <= 0) return `Wind-down time was ${formatTime(windDown.predictedTime)}`;
    if (diffMin <= 5) return "Time to wind down";
    return `Wind down in ${formatDurationWords(diffMin)}, at ${formatTime(windDown.predictedTime)}`;
  });

  let elapsedAsleepText = $derived.by(() => {
    if (!runningSession) return null;
    return formatDurationWords((now.getTime() - new Date(runningSession.startTime).getTime()) / 60000);
  });

  let timeline = $derived(
    appState.selectedChildId ? buildDayTimeline(todayKey(now), appState.selectedSessions, now) : [],
  );

  let hasEverSlept = $derived(appState.selectedSessions.length > 0);

  function isAsleep(childId: string): boolean {
    return (appState.sessionsByChild[childId] ?? []).some((s) => s.endTime === null);
  }

  function avatarFor(child: { avatar: string | null; name: string }): string {
    return child.avatar ?? child.name.slice(0, 1).toUpperCase();
  }

  async function toggleSleep() {
    if (!appState.selectedChildId || toggling) return;
    toggling = true;
    const childId = appState.selectedChildId;
    const childName = appState.selectedChild?.name ?? "";
    const running = await getRunningSession(childId);
    if (running) {
      await endSleepSession(running.id);
    } else {
      await startSleepSession(childId, appState.deviceCaregiverId);
      confirmMessage = `Got it. Sleep well, ${childName}.`;
      setTimeout(() => (confirmMessage = ""), 3000);
    }
    await appState.loadSessions(childId);
    toggling = false;
    fullSync().catch(() => {});
  }

  function startEditingTime() {
    if (!runningSession) return;
    const d = new Date(runningSession.startTime);
    const pad = (n: number) => String(n).padStart(2, "0");
    editStartValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    editingStart = true;
  }

  async function saveEditedTime() {
    if (!runningSession || !appState.selectedChildId) return;
    const newStart = new Date(editStartValue);
    if (newStart <= new Date()) {
      await updateSleepSession(runningSession.id, { startTime: newStart.toISOString() });
      await appState.loadSessions(appState.selectedChildId);
      fullSync().catch(() => {});
    }
    editingStart = false;
  }
</script>

<div class="home">
  <header>
    <div class="top-row">
      {#if appState.deviceCaregiver}
        <p class="greeting muted">{timeAwareGreeting(appState.deviceCaregiver.firstName, now)}</p>
      {/if}
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
    </div>

    <div class="pills {appState.children.length > 2 ? 'compact' : ''}">
      {#each appState.children as child (child.id)}
        <button
          class="pill {child.id === appState.selectedChildId ? 'active' : ''} {appState.children.length > 2 ? 'compact' : ''}"
          onclick={() => appState.selectChild(child.id)}
        >
          <span class="avatar">{avatarFor(child)}</span>
          <span class="status-dot {isAsleep(child.id) ? 'asleep' : 'awake'}"></span>
          {#if appState.children.length <= 2 || child.id === appState.selectedChildId}
            <span>{child.name}</span>
          {/if}
        </button>
      {/each}
    </div>
  </header>

  {#if !appState.selectedChild}
    <p class="muted">Add a child to get started.</p>
  {:else}
    <div class="sweetspot card">
      {#if runningSession}
        <div class="label muted">Asleep for</div>
        <div class="big">{elapsedAsleepText}</div>
        {#if editingStart}
          <div class="edit-row">
            <input type="datetime-local" bind:value={editStartValue} />
            <button class="btn-secondary" onclick={saveEditedTime}>Save</button>
          </div>
        {:else}
          <button class="muted small link" onclick={startEditingTime}>
            since {formatTime(new Date(runningSession.startTime))} · tap to adjust
          </button>
        {/if}
        {#if estimatedWake}
          <div class="estimate muted">
            Probably up around {formatTime(estimatedWake.rangeStart)}–{formatTime(estimatedWake.rangeEnd)} — just an
            estimate
          </div>
        {/if}
      {:else if windDownPhrase}
        <div class="big wind-down">{windDownPhrase}</div>
        {#if windDown && windDown.daysOfData < 3}
          <div class="muted small">
            Still getting to know {appState.selectedChild.name}'s rhythm — predictions will sharpen as more sleeps are
            logged.
          </div>
        {/if}
      {:else if !hasEverSlept}
        <div class="muted">Nothing logged yet today — tap below whenever you're ready.</div>
      {/if}
    </div>

    {#if confirmMessage}
      <p class="confirm muted">{confirmMessage}</p>
    {/if}

    <div class="main-action">
      <button class="btn-primary icon-label {runningSession ? 'active' : ''}" disabled={toggling} onclick={toggleSleep}>
        {#if runningSession}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              stroke-linecap="round"
            />
          </svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
          </svg>
        {/if}
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
    gap: 16px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 20px;
  }
  .greeting {
    font-size: 0.9rem;
    margin: 0;
  }
  .pills {
    display: flex;
    gap: 8px;
  }
  .pills.compact {
    gap: 6px;
  }
  .icon-row {
    display: flex;
    gap: 8px;
  }
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-2);
    font-size: 0.75rem;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pill.compact {
    padding: 8px 10px;
  }
  .sweetspot {
    text-align: center;
    padding: 28px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .label {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .big {
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 1.3;
  }
  .big.wind-down {
    font-size: 1.5rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .estimate {
    font-size: 0.85rem;
  }
  .confirm {
    text-align: center;
    margin: 0;
    font-size: 0.9rem;
    transition: opacity 0.3s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .confirm {
      transition: none;
    }
  }
  .link {
    background: transparent;
    padding: 4px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .edit-row {
    display: flex;
    gap: 8px;
    justify-content: center;
    align-items: center;
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
  .icon-label {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
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
