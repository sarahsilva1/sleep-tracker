<script lang="ts">
  import { onMount } from "svelte";
  import { appState } from "./lib/appState.svelte";
  import { startAutoSync } from "./lib/sync";
  import CaregiverPicker from "./lib/CaregiverPicker.svelte";
  import AddChild from "./lib/AddChild.svelte";
  import Home from "./lib/Home.svelte";
  import AddPastSleep from "./lib/AddPastSleep.svelte";
  import DayReview from "./lib/DayReview.svelte";
  import Trends from "./lib/Trends.svelte";
  import Settings from "./lib/Settings.svelte";

  type View = { name: "home" } | { name: "trends" } | { name: "settings" } | { name: "day"; dateKey: string };

  let view = $state<View>({ name: "home" });
  let showAddPastSleep = $state(false);
  let loaded = $state(false);

  onMount(async () => {
    await appState.loadCaregivers();
    await appState.loadChildren();
    loaded = true;
    startAutoSync();
  });
</script>

{#if !loaded}
  <div class="loading"></div>
{:else if !appState.deviceCaregiverId}
  <CaregiverPicker onDone={() => {}} />
{:else if appState.children.length === 0}
  <AddChild onDone={() => {}} />
{:else if view.name === "home"}
  <Home
    onOpenTrends={() => (view = { name: "trends" })}
    onOpenSettings={() => (view = { name: "settings" })}
    onOpenDay={(dateKey) => (view = { name: "day", dateKey })}
    onAddPastSleep={() => (showAddPastSleep = true)}
  />
  {#if showAddPastSleep}
    <AddPastSleep onDone={() => (showAddPastSleep = false)} />
  {/if}
{:else if view.name === "trends"}
  <Trends onBack={() => (view = { name: "home" })} />
{:else if view.name === "settings"}
  <Settings onBack={() => (view = { name: "home" })} />
{:else if view.name === "day"}
  <DayReview dateKey={view.dateKey} onBack={() => (view = { name: "home" })} />
{/if}

<style>
  .loading {
    min-height: 100vh;
  }
</style>
