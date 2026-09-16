<script lang="ts">
  import { createChild } from "./db";
  import { appState } from "./appState.svelte";

  let { onDone }: { onDone: () => void } = $props();

  let name = $state("");
  let dob = $state("");
  let saving = $state(false);

  async function save() {
    if (!name.trim() || !dob) return;
    saving = true;
    await createChild(name.trim(), dob);
    await appState.loadChildren();
    saving = false;
    name = "";
    dob = "";
    onDone();
  }
</script>

<div class="wrap">
  <div class="card">
    <h1>Welcome</h1>
    <p class="muted">Add a child to start tracking sleep. You can add a second later in Settings.</p>
    <label>
      Name
      <input type="text" bind:value={name} placeholder="e.g. Mira" autocomplete="off" />
    </label>
    <label>
      Date of birth
      <input type="date" bind:value={dob} max={new Date().toISOString().slice(0, 10)} />
    </label>
    <button class="btn-primary" disabled={!name.trim() || !dob || saving} onclick={save}>
      {saving ? "Saving…" : "Start tracking"}
    </button>
  </div>
</div>

<style>
  .wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
  }
  button {
    width: 100%;
    margin-top: 8px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
