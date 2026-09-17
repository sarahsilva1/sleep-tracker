<script lang="ts">
  import { appState } from "./appState.svelte";
  import { addPastSleepSession, listSessionsForChild } from "./db";
  import { fullSync } from "./sync";

  let { onDone }: { onDone: () => void } = $props();

  function toLocalInputValue(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let childId = $state(appState.selectedChildId ?? "");

  function defaultStart(): Date {
    const sessions = appState.sessionsByChild[childId] ?? [];
    const finished = [...sessions].filter((s) => s.endTime).sort((a, b) => b.endTime!.localeCompare(a.endTime!));
    return finished.length ? new Date(finished[0].endTime!) : new Date(Date.now() - 60 * 60 * 1000);
  }

  let start = $state(toLocalInputValue(defaultStart()));
  let end = $state(toLocalInputValue(new Date(defaultStart().getTime() + 60 * 60 * 1000)));
  let error = $state("");
  let saving = $state(false);

  function selectChild(id: string) {
    childId = id;
    const s = defaultStart();
    start = toLocalInputValue(s);
    end = toLocalInputValue(new Date(s.getTime() + 60 * 60 * 1000));
  }

  async function save() {
    error = "";
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!childId) {
      error = "Choose a child.";
      return;
    }
    if (endDate <= startDate) {
      error = "End time must be after start time.";
      return;
    }
    if (startDate > new Date()) {
      error = "Start time can't be in the future.";
      return;
    }
    saving = true;
    await addPastSleepSession(childId, appState.deviceCaregiverId, startDate.toISOString(), endDate.toISOString());
    await appState.loadSessions(childId);
    saving = false;
    fullSync().catch(() => {});
    onDone();
  }
</script>

<div class="sheet">
  <div class="card">
    <h2>Add past sleep</h2>

    {#if appState.children.length > 1}
      <div class="pills">
        {#each appState.children as child (child.id)}
          <button class="pill {child.id === childId ? 'active' : ''}" onclick={() => selectChild(child.id)}>
            {child.name}
          </button>
        {/each}
      </div>
    {/if}

    <label>
      Start
      <input type="datetime-local" bind:value={start} />
    </label>
    <label>
      End
      <input type="datetime-local" bind:value={end} />
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button class="btn-secondary" onclick={onDone}>Cancel</button>
      <button class="btn-primary" disabled={saving} onclick={save}>{saving ? "Saving…" : "Save"}</button>
    </div>
  </div>
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    z-index: 10;
  }
  .card {
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    border-radius: 20px 20px 0 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
  }
  .pills {
    display: flex;
    gap: 8px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .actions button {
    flex: 1;
  }
  .error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
