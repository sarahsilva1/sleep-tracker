import { listChildren, listSessionsForChild } from "./db";
import type { Child, SleepSession } from "./types";

class AppState {
  children = $state<Child[]>([]);
  selectedChildId = $state<string | null>(null);
  sessionsByChild = $state<Record<string, SleepSession[]>>({});

  selectedChild = $derived(this.children.find((c) => c.id === this.selectedChildId) ?? null);
  selectedSessions = $derived(this.selectedChildId ? (this.sessionsByChild[this.selectedChildId] ?? []) : []);

  async loadChildren() {
    this.children = await listChildren();
    if (!this.selectedChildId && this.children.length) {
      this.selectedChildId = this.children[0].id;
    }
    for (const child of this.children) {
      await this.loadSessions(child.id);
    }
  }

  async loadSessions(childId: string) {
    const sessions = await listSessionsForChild(childId);
    this.sessionsByChild = { ...this.sessionsByChild, [childId]: sessions };
  }

  selectChild(id: string) {
    this.selectedChildId = id;
  }
}

export const appState = new AppState();
