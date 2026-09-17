<script lang="ts">
  import { appState } from "./appState.svelte";
  import {
    updateChild,
    setChildHidden,
    listChildren,
    createCaregiver,
    updateCaregiver,
    removeCaregiver,
    setDeviceCaregiverId,
    MAX_CAREGIVERS,
    MAX_CHILDREN,
  } from "./db";
  import { exportCsv, exportJson, importJson } from "./exportData";
  import { syncConfigured } from "./supabaseClient";
  import {
    createFamilyAndGetSetupCode,
    joinFamilyWithSetupCode,
    mintAdditionalSetupCode,
    hasJoinedFamily,
    leaveFamily,
    fullSync,
  } from "./sync";
  import AddChild from "./AddChild.svelte";
  import HuckleberryImport from "./HuckleberryImport.svelte";
  import type { Child } from "./types";

  let { onBack }: { onBack: () => void } = $props();

  let showAddChild = $state(false);
  let showHiddenChildren = $state(false);
  let hiddenChildren = $state<Child[]>([]);
  let editingChildId = $state<string | null>(null);
  let editDraft = $state<Partial<Child>>({});
  let showHuckleberry = $state(false);

  async function refreshHidden() {
    const all = await listChildren(true);
    hiddenChildren = all.filter((c) => c.hidden);
  }
  $effect(() => {
    if (showHiddenChildren) refreshHidden();
  });

  function startEditChild(child: Child) {
    editingChildId = child.id;
    editDraft = { ...child };
  }

  async function saveChildEdit() {
    if (!editingChildId) return;
    await updateChild(editingChildId, {
      name: editDraft.name,
      dateOfBirth: editDraft.dateOfBirth,
      avatar: editDraft.avatar || null,
      typicalBedtime: editDraft.typicalBedtime,
      typicalWakeTime: editDraft.typicalWakeTime,
      typicalNapCount: Number(editDraft.typicalNapCount),
    });
    await appState.loadChildren();
    editingChildId = null;
  }

  async function hideChild(id: string) {
    if (!confirm("Hide this child? Their sleep data is kept and they can be shown again anytime.")) return;
    await setChildHidden(id, true);
    await appState.loadChildren();
  }

  async function unhideChild(id: string) {
    await setChildHidden(id, false);
    await appState.loadChildren();
    await refreshHidden();
  }

  // --- Caregivers ---

  let newCaregiverName = $state("");
  let addingCaregiver = $state(false);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");

  async function addCaregiver() {
    if (!newCaregiverName.trim() || addingCaregiver) return;
    addingCaregiver = true;
    await createCaregiver(newCaregiverName.trim());
    await appState.loadCaregivers();
    newCaregiverName = "";
    addingCaregiver = false;
  }

  function switchTo(id: string) {
    setDeviceCaregiverId(id);
    appState.deviceCaregiverId = id;
  }

  function startRename(id: string, current: string) {
    renamingId = id;
    renameValue = current;
  }

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) return;
    await updateCaregiver(renamingId, { firstName: renameValue.trim() });
    await appState.loadCaregivers();
    renamingId = null;
  }

  async function deleteCaregiver(id: string) {
    if (!confirm("Remove this caregiver? Past entries stay, shown as logged by a removed caregiver.")) return;
    await removeCaregiver(id);
    await appState.loadCaregivers();
  }

  // --- Import ---

  let importError = $state("");
  let importSummary = $state("");

  async function onImportFile(e: Event) {
    importError = "";
    importSummary = "";
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importJson(text);
      await appState.loadChildren();
      await appState.loadCaregivers();
      importSummary = `Imported ${result.childrenAdded} children, ${result.caregiversAdded} caregivers, ${result.sessionsAdded} sleep sessions, ${result.notesAdded} notes.`;
    } catch (err: any) {
      importError = err?.message ?? "Import failed — is this a SweetSpot JSON export?";
    }
    input.value = "";
  }

  // --- Sync ---

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
      syncError = e?.message ?? "Invalid or expired setup code.";
    }
    syncBusy = false;
  }

  async function generateAnotherCode() {
    syncError = "";
    syncBusy = true;
    try {
      generatedCode = await mintAdditionalSetupCode();
    } catch (e: any) {
      syncError = e?.message ?? "Failed to create a new code.";
    }
    syncBusy = false;
  }

  function disconnectSync() {
    if (
      !confirm("Stop syncing this device? Local data stays, but it will no longer share with other caregivers.")
    )
      return;
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
      {#if editingChildId === child.id}
        <div class="edit-child">
          <label>Name <input type="text" bind:value={editDraft.name} /></label>
          <label>Date of birth <input type="date" bind:value={editDraft.dateOfBirth} /></label>
          <label>Avatar (emoji or initials) <input type="text" bind:value={editDraft.avatar} maxlength="4" /></label>
          <label>Typical bedtime <input type="time" bind:value={editDraft.typicalBedtime} /></label>
          <label>Typical wake time <input type="time" bind:value={editDraft.typicalWakeTime} /></label>
          <label>
            Typical naps per day
            <input type="number" min="0" max="4" bind:value={editDraft.typicalNapCount} />
          </label>
          <div class="actions">
            <button class="btn-secondary" onclick={() => (editingChildId = null)}>Cancel</button>
            <button class="btn-primary" onclick={saveChildEdit}>Save</button>
          </div>
          <button class="btn-secondary hide-btn" onclick={() => hideChild(child.id)}>Hide this child</button>
        </div>
      {:else}
        <button class="row" onclick={() => startEditChild(child)}>
          <span>{child.avatar ?? child.name.slice(0, 1).toUpperCase()} {child.name}</span>
          <span class="muted small">{child.dateOfBirth}</span>
        </button>
      {/if}
    {/each}

    {#if hiddenChildren.length > 0 || showHiddenChildren}
      <button class="link muted small" onclick={() => (showHiddenChildren = !showHiddenChildren)}>
        {showHiddenChildren ? "Hide" : "Show"} hidden children
      </button>
      {#if showHiddenChildren}
        {#each hiddenChildren as child (child.id)}
          <div class="row hidden-row">
            <span class="muted">{child.avatar ?? child.name.slice(0, 1).toUpperCase()} {child.name}</span>
            <button class="btn-secondary" onclick={() => unhideChild(child.id)}>Unhide</button>
          </div>
        {/each}
      {/if}
    {/if}

    {#if appState.children.length < MAX_CHILDREN}
      {#if showAddChild}
        <AddChild onDone={() => (showAddChild = false)} />
      {:else}
        <button class="btn-secondary" onclick={() => (showAddChild = true)}>+ Add child</button>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>Caregivers</h2>
    {#each appState.caregivers as caregiver (caregiver.id)}
      {#if renamingId === caregiver.id}
        <div class="row">
          <input type="text" bind:value={renameValue} />
          <button class="btn-secondary" onclick={saveRename}>Save</button>
        </div>
      {:else}
        <div class="row">
          <span>
            {caregiver.avatar ?? caregiver.firstName.slice(0, 1).toUpperCase()}
            {caregiver.firstName}
            {#if caregiver.id === appState.deviceCaregiverId}<span class="muted small">(this device)</span>{/if}
          </span>
          <span class="row-actions">
            {#if caregiver.id !== appState.deviceCaregiverId}
              <button class="btn-secondary" onclick={() => switchTo(caregiver.id)}>Switch to</button>
            {/if}
            <button class="btn-icon small" aria-label="Rename" onclick={() => startRename(caregiver.id, caregiver.firstName)}>
              ✎
            </button>
            <button class="btn-icon small" aria-label="Remove" onclick={() => deleteCaregiver(caregiver.id)}>×</button>
          </span>
        </div>
      {/if}
    {/each}
    {#if appState.caregivers.length < MAX_CAREGIVERS}
      <div class="row">
        <input type="text" placeholder="Add a caregiver" bind:value={newCaregiverName} />
        <button class="btn-secondary" disabled={!newCaregiverName.trim() || addingCaregiver} onclick={addCaregiver}>
          Add
        </button>
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>Export data</h2>
    <div class="actions">
      <button class="btn-secondary" onclick={exportCsv}>Export CSV</button>
      <button class="btn-secondary" onclick={exportJson}>Export JSON</button>
    </div>
  </section>

  <section class="card">
    <h2>Import data</h2>
    <label>
      Restore from a SweetSpot JSON backup
      <input type="file" accept="application/json" onchange={onImportFile} />
    </label>
    {#if importSummary}<p class="muted small">{importSummary}</p>{/if}
    {#if importError}<p class="error">{importError}</p>{/if}
    <button class="btn-secondary" onclick={() => (showHuckleberry = true)}>One-time Huckleberry import</button>
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
            Read this code to the next caregiver to enter on their device — it expires in 30 minutes and works once.
          </p>
        </div>
      {/if}
      <div class="actions">
        <button class="btn-secondary" onclick={() => fullSync()}>Sync now</button>
        <button class="btn-secondary" disabled={syncBusy} onclick={generateAnotherCode}>
          Invite another device
        </button>
      </div>
      <button class="btn-secondary" onclick={disconnectSync}>Stop syncing</button>
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

{#if showHuckleberry}
  <HuckleberryImport onDone={() => (showHuckleberry = false)} />
{/if}

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
    align-items: center;
    background: transparent;
    padding: 8px 0;
    text-align: left;
    min-height: 44px;
    width: 100%;
  }
  .row-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .hidden-row {
    opacity: 0.7;
  }
  .edit-child {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
  }
  .edit-child label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
  }
  .hide-btn {
    color: var(--danger);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions button {
    flex: 1;
  }
  .link {
    background: transparent;
    padding: 4px 0;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 2px;
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
  .btn-icon.small {
    width: 44px;
    height: 44px;
    font-size: 1rem;
  }
</style>
