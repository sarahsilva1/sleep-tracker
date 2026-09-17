import Dexie, { type Table } from "dexie";
import type { Child, Caregiver, SleepSession, DayNote } from "./types";
import { ageInMonths } from "./prediction";

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_BEDTIME = "19:30";
const DEFAULT_WAKE_TIME = "06:30";

function defaultNapCountForAge(ageMonths: number): number {
  if (ageMonths < 6) return 4;
  if (ageMonths < 9) return 3;
  if (ageMonths < 15) return 2;
  if (ageMonths < 36) return 1;
  return 0;
}

class SleepTrackerDB extends Dexie {
  children!: Table<Child, string>;
  caregivers!: Table<Caregiver, string>;
  sessions!: Table<SleepSession, string>;
  notes!: Table<DayNote, string>;

  constructor() {
    super("sleep-tracker");

    this.version(1).stores({
      children: "id, updatedAt",
      sessions: "id, childId, startTime, updatedAt",
      notes: "id, [childId+date], updatedAt",
      overrides: "[childId+slot]",
    });

    // v2: caregivers, avatars/bedtime/wake/nap-count/hidden on children,
    // logged_by + soft delete on sessions, author on notes. The old
    // per-slot SweetSpot override table is dropped (cut per spec).
    this.version(2)
      .stores({
        children: "id, updatedAt",
        caregivers: "id, updatedAt",
        sessions: "id, childId, startTime, updatedAt",
        notes: "id, [childId+date], updatedAt",
        overrides: null,
      })
      .upgrade(async (tx) => {
        const now = nowIso();
        await tx
          .table("children")
          .toCollection()
          .modify((c: any) => {
            const ageMonths = ageInMonths(c.dateOfBirth, new Date());
            c.avatar = c.avatar ?? null;
            c.typicalBedtime = c.typicalBedtime ?? DEFAULT_BEDTIME;
            c.typicalWakeTime = c.typicalWakeTime ?? DEFAULT_WAKE_TIME;
            c.typicalNapCount = c.typicalNapCount ?? defaultNapCountForAge(ageMonths);
            c.hidden = c.hidden ?? false;
            delete c.deleted;
          });
        await tx
          .table("sessions")
          .toCollection()
          .modify((s: any) => {
            s.loggedBy = s.loggedBy ?? null;
            s.deletedAt = s.deleted ? now : null;
            delete s.deleted;
          });
        await tx
          .table("notes")
          .toCollection()
          .modify((n: any) => {
            n.author = n.author ?? null;
            delete n.deleted;
          });
      });
  }
}

export const db = new SleepTrackerDB();

// --- Device caregiver identity (local to this browser/install, not auth) ---

const CAREGIVER_ID_KEY = "sleep-tracker:caregiver-id";

export function getDeviceCaregiverId(): string | null {
  return localStorage.getItem(CAREGIVER_ID_KEY);
}

export function setDeviceCaregiverId(id: string): void {
  localStorage.setItem(CAREGIVER_ID_KEY, id);
}

export function clearDeviceCaregiverId(): void {
  localStorage.removeItem(CAREGIVER_ID_KEY);
}

// --- Caregivers ---

export const MAX_CAREGIVERS = 4;

export async function createCaregiver(firstName: string, avatar: string | null = null): Promise<Caregiver> {
  const caregiver: Caregiver = {
    id: newId(),
    firstName,
    avatar,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.caregivers.put(caregiver);
  return caregiver;
}

export async function listCaregivers(): Promise<Caregiver[]> {
  return db.caregivers.toArray();
}

export async function updateCaregiver(
  id: string,
  patch: Partial<Pick<Caregiver, "firstName" | "avatar">>,
): Promise<void> {
  await db.caregivers.update(id, { ...patch, updatedAt: nowIso() });
}

export async function removeCaregiver(id: string): Promise<void> {
  await db.caregivers.delete(id);
  if (getDeviceCaregiverId() === id) clearDeviceCaregiverId();
}

// --- Children ---

export const MAX_CHILDREN = 4;

export async function createChild(
  name: string,
  dateOfBirth: string,
  overrides: Partial<Pick<Child, "avatar" | "typicalBedtime" | "typicalWakeTime" | "typicalNapCount">> = {},
): Promise<Child> {
  const ageMonths = ageInMonths(dateOfBirth, new Date());
  const child: Child = {
    id: newId(),
    name,
    dateOfBirth,
    avatar: overrides.avatar ?? null,
    typicalBedtime: overrides.typicalBedtime ?? DEFAULT_BEDTIME,
    typicalWakeTime: overrides.typicalWakeTime ?? DEFAULT_WAKE_TIME,
    typicalNapCount: overrides.typicalNapCount ?? defaultNapCountForAge(ageMonths),
    hidden: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.children.put(child);
  return child;
}

export async function listChildren(includeHidden = false): Promise<Child[]> {
  const all = await db.children.toArray();
  return includeHidden ? all : all.filter((c) => !c.hidden);
}

export async function updateChild(
  id: string,
  patch: Partial<
    Pick<Child, "name" | "dateOfBirth" | "avatar" | "typicalBedtime" | "typicalWakeTime" | "typicalNapCount">
  >,
): Promise<void> {
  await db.children.update(id, { ...patch, updatedAt: nowIso() });
}

export async function setChildHidden(id: string, hidden: boolean): Promise<void> {
  await db.children.update(id, { hidden, updatedAt: nowIso() });
}

// --- Sleep sessions ---

export async function startSleepSession(
  childId: string,
  loggedBy: string | null,
  startTime = nowIso(),
): Promise<SleepSession> {
  const session: SleepSession = {
    id: newId(),
    childId,
    startTime,
    endTime: null,
    excluded: false,
    loggedBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  };
  await db.sessions.put(session);
  return session;
}

export async function endSleepSession(id: string, endTime = nowIso()): Promise<void> {
  await db.sessions.update(id, { endTime, updatedAt: nowIso() });
}

export async function addPastSleepSession(
  childId: string,
  loggedBy: string | null,
  startTime: string,
  endTime: string,
): Promise<SleepSession> {
  const session: SleepSession = {
    id: newId(),
    childId,
    startTime,
    endTime,
    excluded: false,
    loggedBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
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

/** Soft delete: hides the session everywhere immediately, but stays undoable for 5 minutes. */
export async function softDeleteSession(id: string): Promise<void> {
  await db.sessions.update(id, { deletedAt: nowIso(), updatedAt: nowIso() });
}

export async function undoDeleteSession(id: string): Promise<void> {
  await db.sessions.update(id, { deletedAt: null, updatedAt: nowIso() });
}

export const UNDO_WINDOW_MS = 5 * 60 * 1000;

export function isWithinUndoWindow(deletedAt: string): boolean {
  return Date.now() - new Date(deletedAt).getTime() < UNDO_WINDOW_MS;
}

export async function getRunningSession(childId: string): Promise<SleepSession | undefined> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  return sessions.find((s) => !s.deletedAt && s.endTime === null);
}

export async function listSessionsForChild(childId: string): Promise<SleepSession[]> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  return sessions.filter((s) => !s.deletedAt).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Soft-deleted sessions still inside their 5-minute undo window. */
export async function listRecentlyDeletedSessions(childId: string): Promise<SleepSession[]> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  return sessions.filter((s) => s.deletedAt && isWithinUndoWindow(s.deletedAt));
}

// --- Day notes ---

export async function getDayNote(childId: string, date: string): Promise<DayNote | undefined> {
  return db.notes.where("[childId+date]").equals([childId, date]).first();
}

export async function setDayNote(childId: string, date: string, text: string, author: string | null): Promise<void> {
  const existing = await getDayNote(childId, date);
  if (existing) {
    await db.notes.update(existing.id, { text, author, updatedAt: nowIso() });
  } else {
    const note: DayNote = {
      id: newId(),
      childId,
      date,
      text,
      author,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.notes.put(note);
  }
}
