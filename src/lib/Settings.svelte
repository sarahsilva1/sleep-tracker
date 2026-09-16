<script lang="ts">
  import { appState } from "./appState.svelte";
  import { getOverride, setOverride, clearOverride } from "./db";
  import { exportCsv, exportJson } from "./exportData";
  import { syncConfigured } from "./supabaseClient";
  import { createFamilyAndGetSetupCode, joinFamilyWithSetupCode, hasJoinedFamily, leaveFamily, fullSync } from "./sync";
  import AddChild from "./AddChild.svelte";
  import type { SleepSlot } from "./types";

  let { onBack }: { onBack: () => void } = $props();

  const SLOTS: { key: SleepSlot; label: string }[] = [
    { key: "nap1", label: "Nap 1" },
    { key: "nap2", label: "Nap 2" },
    { key: "nap3", label: "Nap 3" },
    { key: "bedtime", label: "Bedtime" },
  ];

  let overridesByChild = $state<Record<string, Record<string, number | undefined>>>({});
  let showAddChild = $state(false);

  $effect(() => {
    (async () => {
      const result: Record<string, Record<string, number | undefined>> = {};
      for (const child of appState.children) {
        result[child.id] = {};
        for (const slot of SLOTS) {
          const o = await getOverride(child.id, slot.key);
          result[child.id][slot.key] = o?.wakeWindowMinutes;
        }
      }
      overridesByChild = result;
    })();
  });

  async function updateOverride(childId: string, slot: SleepSlot, value: string) {
    if (value === "") {
      await clearOverride(childId, slot);
    } else {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      await setOverride(childId, slot, minutes);
    }
    overridesByChild = {
      ...overridesByChild,
      [childId]: { ...overridesByChild[childId], [slot]: value === "" ? undefined : Number(value) },
    };
  }

  let syncBusy = $state(false);
  let syncError = $state("");
  let generatedCode = $state("");
  let joinCode = $state("");
  let joined = $state(hasJoinedFamily());

  async function createSync() {
    syncError = "";
    syncBusy = true;
    try {
      generatedCode = await createFamilyAndGetSetupCode();
      joined = true;
    } catch (e: any) {
      syncError = e?.message ?? "Failed to create sync code.";
    }
    syncBusy = false;
  }

  async function joinSync() {
    syncError = "";
    syncBusy = true;
    try {
      await joinFamilyWithSetupCode(joinCode);
      joined = true;
      await fullSync();
    } catch (e: any) {
      syncError = e?.message ?? "Invalid setup code.";
    }
    syncBusy = false;
  }

  function disconnectSync() {
    if (!confirm("Stop syncing this device? Local data stays, but it will no longer share with the other caregiver.")) return;
    leaveFamily();
    joined = false;
    generatedCode = "";
  }
</script>

<div class="settings">
  <header>
    <button class="btn-icon" aria-label="Back" onclick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <h1>Settings</h1>
  </header>

  <section class="card">
    <h2>Children</h2>
    {#each appState.children as child (child.id)}
      <div class="row">
        <span>{child.name}</span>
        <span class="muted small">{child.dateOfBirth}</span>
      </div>
    {/each}
    {#if appState.children.length < 2}
      {#if showAddChild}
        <AddChild onDone={() => (showAddChild = false)} />
      {:else}
        <button class="btn-secondary" onclick={() => (showAddChild = true)}>+ Add second child</button>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>SweetSpot overrides</h2>
    <p class="muted small">Leave blank to use the automatic prediction.</p>
    {#each appState.children as child (child.id)}
      <div class="child-overrides">
        <span class="muted small">{child.name}</span>
        {#each SLOTS as slot (slot.key)}
          <label class="override-row">
            {slot.label}
            <input
              type="number"
              min="1"
              placeholder="auto"
              value={overridesByChild[child.id]?.[slot.key] ?? ""}
              onchange={(e) => updateOverride(child.id, slot.key, (e.target as HTMLInputElement).value)}
            />
            <span class="muted small">min</span>
          </label>
        {/each}
      </div>
    {/each}
  </section>

  <section class="card">
    <h2>Export data</h2>
    <div class="actions">
      <button class="btn-secondary" onclick={exportCsv}>Export CSV</button>
      <button class="btn-secondary" onclick={exportJson}>Export JSON</button>
    </div>
  </section>

  <section class="card">
    <h2>Sync between caregivers</h2>
    {#if !syncConfigured}
      <p class="muted small">Sync isn't configured for this build. The app works fully offline on this device.</p>
    {:else if joined}
      <p class="muted small">This device is syncing.</p>
      {#if generatedCode}
        <div class="code-display">
          <span class="code">{generatedCode}</span>
          <p class="muted small">
            Read this code to your co-parent to enter on their device. It won't be shown again — write it down if
            needed.
          </p>
        </div>
      {/if}
      <div class="actions">
        <button class="btn-secondary" onclick={() => fullSync()}>Sync now</button>
        <button class="btn-secondary" onclick={disconnectSync}>Stop syncing</button>
      </div>
    {:else}
      <div class="sync-setup">
        <button class="btn-secondary" disabled={syncBusy} onclick={createSync}>Create sync code</button>
        <div class="join-row">
          <input type="text" placeholder="XXXX-XXXX" bind:value={joinCode} />
          <button class="btn-secondary" disabled={syncBusy || !joinCode.trim()} onclick={joinSync}>Join</button>
        </div>
      </div>
    {/if}
    {#if syncError}
      <p class="error">{syncError}</p>
    {/if}
  </section>
</div>

<style>
  .settings {
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
  h2 {
    font-size: 1rem;
    margin: 0 0 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
  }
  .child-overrides {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
  }
  .override-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
  }
  .override-row input {
    width: 70px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions button {
    flex: 1;
  }
  .code-display {
    text-align: center;
    padding: 10px 0;
  }
  .code {
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .join-row {
    display: flex;
    gap: 8px;
  }
  .join-row input {
    flex: 1;
  }
  .sync-setup {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
