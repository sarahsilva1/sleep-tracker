import { listChildren, listCaregivers, listSessionsForChild, getDeviceCaregiverId } from "./db";
import type { Child, Caregiver, SleepSession } from "./types";

class AppState {
  children = $state<Child[]>([]);
  caregivers = $state<Caregiver[]>([]);
  deviceCaregiverId = $state<string | null>(null);
  selectedChildId = $state<string | null>(null);
  sessionsByChild = $state<Record<string, SleepSession[]>>({});

  selectedChild = $derived(this.children.find((c) => c.id === this.selectedChildId) ?? null);
  selectedSessions = $derived(this.selectedChildId ? (this.sessionsByChild[this.selectedChildId] ?? []) : []);
  deviceCaregiver = $derived(this.caregivers.find((c) => c.id === this.deviceCaregiverId) ?? null);

  async loadChildren() {
    this.children = await listChildren();
    if (!this.selectedChildId || !this.children.some((c) => c.id === this.selectedChildId)) {
      this.selectedChildId = this.children[0]?.id ?? null;
    }
    for (const child of this.children) {
      await this.loadSessions(child.id);
    }
  }

  async loadCaregivers() {
    this.caregivers = await listCaregivers();
    this.deviceCaregiverId = getDeviceCaregiverId();
  }

  async loadSessions(childId: string) {
    const sessions = await listSessionsForChild(childId);
    this.sessionsByChild = { ...this.sessionsByChild, [childId]: sessions };
  }

  selectChild(id: string) {
    this.selectedChildId = id;
  }

  caregiverName(id: string | null): string {
    if (!id) return "Imported";
    return this.caregivers.find((c) => c.id === id)?.firstName ?? "a former caregiver";
  }
}

export const appState = new AppState();
