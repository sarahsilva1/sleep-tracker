import Dexie, { type Table } from "dexie";
import type { Child, SleepSession, DayNote, SweetSpotOverride } from "./types";

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

class SleepTrackerDB extends Dexie {
  children!: Table<Child, string>;
  sessions!: Table<SleepSession, string>;
  notes!: Table<DayNote, string>;
  overrides!: Table<SweetSpotOverride, [string, string]>;

  constructor() {
    super("sleep-tracker");
    this.version(1).stores({
      children: "id, updatedAt",
      sessions: "id, childId, startTime, updatedAt",
      notes: "id, [childId+date], updatedAt",
      overrides: "[childId+slot]",
    });
  }
}

export const db = new SleepTrackerDB();

// --- Children ---

export async function createChild(name: string, dateOfBirth: string): Promise<Child> {
  const child: Child = {
    id: newId(),
    name,
    dateOfBirth,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.children.put(child);
  return child;
}

export async function listChildren(): Promise<Child[]> {
  const all = await db.children.toArray();
  return all.filter((c) => !c.deleted);
}

export async function updateChild(id: string, patch: Partial<Pick<Child, "name" | "dateOfBirth">>): Promise<void> {
  await db.children.update(id, { ...patch, updatedAt: nowIso() });
}

// --- Sleep sessions ---

export async function startSleepSession(childId: string, startTime = nowIso()): Promise<SleepSession> {
  const session: SleepSession = {
    id: newId(),
    childId,
    startTime,
    endTime: null,
    excluded: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.sessions.put(session);
  return session;
}

export async function endSleepSession(id: string, endTime = nowIso()): Promise<void> {
  await db.sessions.update(id, { endTime, updatedAt: nowIso() });
}

export async function addPastSleepSession(
  childId: string,
  startTime: string,
  endTime: string,
): Promise<SleepSession> {
  const session: SleepSession = {
    id: newId(),
    childId,
    startTime,
    endTime,
    excluded: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.sessions.put(session);
  return session;
}

export async function updateSleepSession(
  id: string,
  patch: Partial<Pick<SleepSession, "startTime" | "endTime" | "excluded">>,
): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteSleepSession(id: string): Promise<void> {
  await db.sessions.update(id, { deleted: true, updatedAt: nowIso() });
}

export async function getRunningSession(childId: string): Promise<SleepSession | undefined> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  return sessions.find((s) => !s.deleted && s.endTime === null);
}

export async function listSessionsForChild(childId: string): Promise<SleepSession[]> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  return sessions.filter((s) => !s.deleted).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// --- Day notes ---

export async function getDayNote(childId: string, date: string): Promise<DayNote | undefined> {
  const matches = await db.notes.where("[childId+date]").equals([childId, date]).toArray();
  return matches.find((n) => !n.deleted);
}

export async function setDayNote(childId: string, date: string, text: string): Promise<void> {
  const existing = await getDayNote(childId, date);
  if (existing) {
    await db.notes.update(existing.id, { text, updatedAt: nowIso() });
  } else {
    const note: DayNote = {
      id: newId(),
      childId,
      date,
      text,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.notes.put(note);
  }
}

// --- Sweet spot overrides ---

export async function getOverride(childId: string, slot: string): Promise<SweetSpotOverride | undefined> {
  return db.overrides.get([childId, slot]);
}

export async function setOverride(childId: string, slot: SweetSpotOverride["slot"], wakeWindowMinutes: number) {
  await db.overrides.put({ childId, slot, wakeWindowMinutes });
}

export async function clearOverride(childId: string, slot: string): Promise<void> {
  await db.overrides.delete([childId, slot]);
}
