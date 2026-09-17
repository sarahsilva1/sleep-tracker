<script lang="ts">
  import { appState } from "./appState.svelte";
  import { createCaregiver, setDeviceCaregiverId, MAX_CAREGIVERS } from "./db";

  let { onDone }: { onDone: () => void } = $props();

  let newName = $state("");
  let saving = $state(false);

  function choose(id: string) {
    setDeviceCaregiverId(id);
    appState.deviceCaregiverId = id;
    onDone();
  }

  async function addAndChoose() {
    if (!newName.trim() || saving) return;
    saving = true;
    const caregiver = await createCaregiver(newName.trim());
    await appState.loadCaregivers();
    saving = false;
    choose(caregiver.id);
  }
</script>

<div class="wrap">
  <div class="card">
    <h1>Who's this?</h1>
    <p class="muted">So we know who's logging — this device will remember your choice.</p>

    {#if appState.caregivers.length > 0}
      <div class="list">
        {#each appState.caregivers as caregiver (caregiver.id)}
          <button class="btn-secondary row" onclick={() => choose(caregiver.id)}>
            {caregiver.avatar ?? caregiver.firstName.slice(0, 1).toUpperCase()}
            <span>{caregiver.firstName}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if appState.caregivers.length < MAX_CAREGIVERS}
      <label>
        Add yourself
        <input type="text" bind:value={newName} placeholder="Your first name" autocomplete="off" />
      </label>
      <button class="btn-primary" disabled={!newName.trim() || saving} onclick={addAndChoose}>
        {saving ? "Saving…" : "That's me"}
      </button>
    {/if}
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
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    min-height: 44px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
