<script lang="ts">
  import { appState } from "./appState.svelte";
  import { importHuckleberryCsv, type HuckleberryImportResult } from "./huckleberryImport";

  let { onDone }: { onDone: () => void } = $props();

  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let childId = $state(appState.children[0]?.id ?? "");
  let timeZone = $state(deviceTimeZone);
  let fileText = $state<string | null>(null);
  let fileName = $state("");
  let running = $state(false);
  let error = $state("");
  let result = $state<HuckleberryImportResult | null>(null);

  const zones: string[] =
    typeof (Intl as any).supportedValuesOf === "function"
      ? (Intl as any).supportedValuesOf("timeZone")
      : [deviceTimeZone];

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;
    fileText = await file.text();
  }

  async function run() {
    if (!fileText || !childId) return;
    running = true;
    error = "";
    try {
      result = await importHuckleberryCsv(fileText, { childId, timeZone });
      await appState.loadSessions(childId);
    } catch (e: any) {
      error = e?.message ?? "Import failed.";
    }
    running = false;
  }
</script>

<div class="sheet">
  <div class="card">
    <h2>Import from Huckleberry</h2>
    <p class="muted small">
      One-time import of a Huckleberry CSV export. Run once per child — the file covers a single child, so there's no
      way to tell them apart automatically.
    </p>

    {#if result}
      <div class="summary">
        <p>Imported {result.imported} of {result.totalRows} rows.</p>
        <ul class="muted small">
          <li>{result.nonSleepIgnored} non-sleep rows ignored</li>
          <li>{result.duplicatesSkipped} exact duplicates skipped</li>
          <li>{result.overlapsSkipped} overlapping sessions skipped (review and re-add manually if needed)</li>
          <li>{result.missingEndSkipped} rows skipped for missing/invalid times</li>
          <li>{result.notesImported} day notes imported</li>
        </ul>
      </div>
      <button class="btn-primary" onclick={onDone}>Done</button>
    {:else}
      <label>
        Child
        <select bind:value={childId}>
          {#each appState.children as child (child.id)}
            <option value={child.id}>{child.name}</option>
          {/each}
        </select>
      </label>

      <label>
        Timezone the export was recorded in
        <select bind:value={timeZone}>
          {#each zones as zone (zone)}
            <option value={zone}>{zone}</option>
          {/each}
        </select>
      </label>
      <p class="muted small">
        Sessions originally recorded in a different timezone (e.g. while travelling) will be reinterpreted as this
        one.
      </p>

      <label>
        CSV file
        <input type="file" accept=".csv,text/csv" onchange={onFileChange} />
      </label>
      {#if fileName}<p class="muted small">Selected: {fileName}</p>{/if}

      {#if error}<p class="error">{error}</p>{/if}

      <div class="actions">
        <button class="btn-secondary" onclick={onDone}>Cancel</button>
        <button class="btn-primary" disabled={!fileText || !childId || running} onclick={run}>
          {running ? "Importing…" : "Import"}
        </button>
      </div>
    {/if}
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
    max-height: 85vh;
    overflow-y: auto;
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
  select,
  input[type="file"] {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 10px 12px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions button {
    flex: 1;
  }
  .error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0;
  }
  .summary ul {
    margin: 8px 0 0;
    padding-left: 18px;
  }
</style>
