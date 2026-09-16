<script lang="ts">
  import { appState } from "./appState.svelte";
  import { updateSleepSession, deleteSleepSession, getDayNote, setDayNote } from "./db";
  import { buildDayTimeline } from "./timeline";
  import TimelineBar from "./TimelineBar.svelte";
  import { fullSync } from "./sync";

  let { dateKey, onBack }: { dateKey: string; onBack: () => void } = $props();

  let noteText = $state("");
  let noteSaved = $state(true);

  $effect(() => {
    const childId = appState.selectedChildId;
    if (!childId) return;
    getDayNote(childId, dateKey).then((n) => {
      noteText = n?.text ?? "";
      noteSaved = true;
    });
  });

  let daySessions = $derived(
    appState.selectedSessions
      .filter((s) => localKey(s.startTime) === dateKey)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  );

  let allExcluded = $derived(daySessions.length > 0 && daySessions.every((s) => s.excluded));

  let dayEnd = $derived(new Date(new Date(dateKey + "T00:00:00").getTime() + 24 * 60 * 60 * 1000));
  let timelineUntil = $derived(new Date() < dayEnd ? new Date() : dayEnd);
  let timeline = $derived(buildDayTimeline(dateKey, appState.selectedSessions, timelineUntil));

  function localKey(iso: string): string {
    const d = new Date(iso);
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

  async function removeSession(id: string) {
    const childId = appState.selectedChildId;
    if (!childId) return;
    if (!confirm("Delete this sleep entry?")) return;
    await deleteSleepSession(id);
    await appState.loadSessions(childId);
    fullSync().catch(() => {});
  }

  async function saveNote() {
    const childId = appState.selectedChildId;
    if (!childId) return;
    await setDayNote(childId, dateKey, noteText);
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
    <h1>{dateKey}</h1>
  </header>

  <TimelineBar segments={timeline} />

  <section class="card log">
    {#if daySessions.length === 0}
      <p class="muted">No sleep logged this day.</p>
    {:else}
      {#each daySessions as s (s.id)}
        <div class="row">
          <span>{formatRange(s.startTime, s.endTime)}</span>
          <button class="btn-icon small" aria-label="Delete" onclick={() => removeSession(s.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      {/each}
    {/if}
  </section>

  <section class="card">
    <label class="toggle">
      <input type="checkbox" checked={allExcluded} onchange={toggleExcludeAll} disabled={daySessions.length === 0} />
      Exclude this day from predictions
    </label>
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
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn-icon.small {
    width: 30px;
    height: 30px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
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
