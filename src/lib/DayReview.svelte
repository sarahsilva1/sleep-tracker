<script lang="ts">
  import { appState } from "./appState.svelte";
  import {
    updateSleepSession,
    softDeleteSession,
    undoDeleteSession,
    listRecentlyDeletedSessions,
    getDayNote,
    setDayNote,
  } from "./db";
  import { buildDayTimeline } from "./timeline";
  import { dayKeyForSession, classifySessions } from "./prediction";
  import TimelineBar from "./TimelineBar.svelte";
  import { fullSync } from "./sync";
  import type { SleepSession, SleepSlot } from "./types";

  let { dateKey, onBack }: { dateKey: string; onBack: () => void } = $props();

  let noteText = $state("");
  let noteSaved = $state(true);
  let recentlyDeleted = $state<SleepSession[]>([]);
  let editingId = $state<string | null>(null);
  let editStart = $state("");
  let editEnd = $state("");

  const SLOT_LABELS: Record<SleepSlot, string> = {
    nap1: "Nap 1",
    nap2: "Nap 2",
    nap3: "Nap 3",
    nap4: "Nap 4",
    bedtime: "Bedtime",
  };

  async function refreshDeleted() {
    if (appState.selectedChildId) {
      recentlyDeleted = await listRecentlyDeletedSessions(appState.selectedChildId);
    }
  }

  $effect(() => {
    const childId = appState.selectedChildId;
    if (!childId) return;
    getDayNote(childId, dateKey).then((n) => {
      noteText = n?.text ?? "";
      noteSaved = true;
    });
    refreshDeleted();
    const interval = setInterval(refreshDeleted, 15000);
    return () => clearInterval(interval);
  });

  let slotBySessionId = $derived(
    appState.selectedChild ? classifySessions(appState.selectedSessions, appState.selectedChild) : new Map(),
  );

  let daySessions = $derived(
    appState.selectedChild
      ? appState.selectedSessions
          .filter((s) => dayKeyForSession(s, appState.selectedChild!) === dateKey)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      : [],
  );

  let allExcluded = $derived(daySessions.length > 0 && daySessions.every((s) => s.excluded));

  let dayEnd = $derived(new Date(new Date(dateKey + "T00:00:00").getTime() + 24 * 60 * 60 * 1000));
  let timelineUntil = $derived(new Date() < dayEnd ? new Date() : dayEnd);
  let timeline = $derived(buildDayTimeline(dateKey, appState.selectedSessions, timelineUntil));

  function shiftDay(deltaDays: number): string {
    const d = new Date(dateKey + "T00:00:00");
    d.setDate(d.getDate() + deltaDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function formatRange(start: string, end: string | null): string {
    const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    const s = new Date(start).toLocaleTimeString(undefined, opts);
    if (!end) return `${s} → asleep now`;
    const e = new Date(end).toLocaleTimeString(undefined, opts);
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const dur = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `${s} → ${e} (${dur})`;
  }

  function toLocalInputValue(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function toggleExcludeAll() {
    const childId = appState.selectedChildId;
    if (!childId) return;
    const newValue = !allExcluded;
    for (const s of daySessions) {
      await updateSleepSession(s.id, { excluded: newValue });
    }
    await appState.loadSessions(childId);
    fullSync().catch(() => {});
  }

  function startEdit(session: SleepSession) {
    editingId = session.id;
    editStart = toLocalInputValue(session.startTime);
    editEnd = session.endTime ? toLocalInputValue(session.endTime) : "";
  }

  async function saveEdit(session: SleepSession) {
    const childId = appState.selectedChildId;
    if (!childId) return;
    const patch: Partial<Pick<SleepSession, "startTime" | "endTime">> = {
      startTime: new Date(editStart).toISOString(),
    };
    if (session.endTime) patch.endTime = new Date(editEnd).toISOString();
    await updateSleepSession(session.id, patch);
    await appState.loadSessions(childId);
    editingId = null;
    fullSync().catch(() => {});
  }

  async function removeSession(id: string) {
    const childId = appState.selectedChildId;
    if (!childId) return;
    await softDeleteSession(id);
    await appState.loadSessions(childId);
    await refreshDeleted();
    fullSync().catch(() => {});
  }

  async function undoRemove(id: string) {
    const childId = appState.selectedChildId;
    if (!childId) return;
    await undoDeleteSession(id);
    await appState.loadSessions(childId);
    await refreshDeleted();
    fullSync().catch(() => {});
  }

  async function saveNote() {
    const childId = appState.selectedChildId;
    if (!childId) return;
    await setDayNote(childId, dateKey, noteText, appState.deviceCaregiverId);
    noteSaved = true;
    fullSync().catch(() => {});
  }
</script>

<div class="day">
  <header>
    <button class="btn-icon" aria-label="Back" onclick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div class="date-nav">
      <button class="btn-icon small" aria-label="Previous day" onclick={() => (dateKey = shiftDay(-1))}>‹</button>
      <h1>{dateKey}</h1>
      <button class="btn-icon small" aria-label="Next day" onclick={() => (dateKey = shiftDay(1))}>›</button>
    </div>
  </header>

  <TimelineBar segments={timeline} />

  {#if recentlyDeleted.length > 0}
    <div class="undo-list">
      {#each recentlyDeleted as s (s.id)}
        <div class="undo-row muted small">
          <span>Removed a sleep entry ({new Date(s.startTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})</span>
          <button class="link" onclick={() => undoRemove(s.id)}>Undo</button>
        </div>
      {/each}
    </div>
  {/if}

  <section class="card log">
    {#if daySessions.length === 0}
      <p class="muted">Nothing logged this day.</p>
    {:else}
      {#each daySessions as s (s.id)}
        <div class="row-wrap">
          {#if editingId === s.id}
            <div class="edit-block">
              <label>
                Start
                <input type="datetime-local" bind:value={editStart} />
              </label>
              {#if s.endTime}
                <label>
                  End
                  <input type="datetime-local" bind:value={editEnd} />
                </label>
              {/if}
              <div class="actions">
                <button class="btn-secondary" onclick={() => (editingId = null)}>Cancel</button>
                <button class="btn-primary" onclick={() => saveEdit(s)}>Save</button>
              </div>
            </div>
          {:else}
            <button class="row" onclick={() => startEdit(s)}>
              <span>
                <span class="slot-label muted">{SLOT_LABELS[slotBySessionId.get(s.id) as SleepSlot]}</span>
                {formatRange(s.startTime, s.endTime)}
                <span class="attribution faint"> · logged by {appState.caregiverName(s.loggedBy)}</span>
              </span>
            </button>
            <button class="btn-icon small" aria-label="Delete" onclick={() => removeSession(s.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </section>

  <section class="card {allExcluded ? 'excluded' : ''}">
    {#if allExcluded}
      <button class="quiet-toggle muted" onclick={toggleExcludeAll} disabled={daySessions.length === 0}>
        Not counted toward predictions · tap to include
      </button>
    {:else}
      <button class="quiet-toggle" onclick={toggleExcludeAll} disabled={daySessions.length === 0}>
        Exclude this day from predictions
      </button>
    {/if}
  </section>

  <section class="card note">
    <label>
      Note
      <textarea
        rows="3"
        bind:value={noteText}
        oninput={() => (noteSaved = false)}
        onblur={saveNote}
        placeholder="Anything worth remembering about today…"
      ></textarea>
    </label>
    {#if !noteSaved}
      <button class="btn-secondary" onclick={saveNote}>Save note</button>
    {/if}
  </section>
</div>

<style>
  .day {
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
  .date-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    justify-content: center;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: transparent;
    padding: 6px 0;
    text-align: left;
    min-height: 44px;
  }
  .slot-label {
    font-size: 0.8rem;
    margin-right: 6px;
  }
  .attribution {
    font-size: 0.8rem;
  }
  .btn-icon.small {
    width: 44px;
    height: 44px;
    font-size: 1.2rem;
  }
  .undo-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .undo-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .link {
    background: transparent;
    padding: 4px;
    text-decoration: underline;
    text-underline-offset: 2px;
    color: var(--accent);
  }
  .edit-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .edit-block label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
  }
  .edit-block .actions {
    display: flex;
    gap: 8px;
  }
  .edit-block .actions button {
    flex: 1;
  }
  .quiet-toggle {
    background: transparent;
    padding: 0;
    width: 100%;
    text-align: left;
    min-height: 44px;
  }
  .card.excluded {
    opacity: 0.7;
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .note label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
  }
  textarea {
    resize: vertical;
  }
</style>
