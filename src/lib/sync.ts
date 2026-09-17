import { supabase, syncConfigured } from "./supabaseClient";
import { db, nowIso } from "./db";
import type { Child, Caregiver, SleepSession, DayNote } from "./types";

const FAMILY_ID_KEY = "sleep-tracker:family-id";

export function getFamilyId(): string | null {
  return localStorage.getItem(FAMILY_ID_KEY);
}

export function hasJoinedFamily(): boolean {
  return getFamilyId() !== null;
}

function setFamilyId(id: string) {
  localStorage.setItem(FAMILY_ID_KEY, id);
}

export function leaveFamily() {
  localStorage.removeItem(FAMILY_ID_KEY);
}

async function ensureAnonymousSession(): Promise<void> {
  if (!supabase) throw new Error("Sync is not configured");
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }
}

/** Creates a new family and returns the one-time setup code to share with the other caregiver. */
export async function createFamilyAndGetSetupCode(): Promise<string> {
  if (!supabase) throw new Error("Sync is not configured");
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc("create_family").single<{
    family_id: string;
    setup_code: string;
  }>();
  if (error || !data) throw error ?? new Error("Failed to create family");
  setFamilyId(data.family_id);
  return data.setup_code;
}

/** Redeems a setup code from the other caregiver's device, joining their family. */
export async function joinFamilyWithSetupCode(code: string): Promise<void> {
  if (!supabase) throw new Error("Sync is not configured");
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc("redeem_setup_code", { code: code.trim() }).single<string>();
  if (error || !data) throw error ?? new Error("Invalid or expired setup code");
  setFamilyId(data);
}

/** Mints an additional setup code for a 3rd/4th device, without creating a second family. */
export async function mintAdditionalSetupCode(): Promise<string> {
  if (!supabase) throw new Error("Sync is not configured");
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc("create_setup_code").single<string>();
  if (error || !data) throw error ?? new Error("Failed to create a new code");
  return data;
}

// --- Row mapping (camelCase local <-> snake_case remote) ---

function caregiverToRemote(c: Caregiver, familyId: string) {
  return {
    id: c.id,
    family_id: familyId,
    first_name: c.firstName,
    avatar: c.avatar,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}
function caregiverFromRemote(r: any): Caregiver {
  return { id: r.id, firstName: r.first_name, avatar: r.avatar, createdAt: r.created_at, updatedAt: r.updated_at };
}

function childToRemote(c: Child, familyId: string) {
  return {
    id: c.id,
    family_id: familyId,
    name: c.name,
    date_of_birth: c.dateOfBirth,
    avatar: c.avatar,
    typical_bedtime: c.typicalBedtime,
    typical_wake_time: c.typicalWakeTime,
    typical_nap_count: c.typicalNapCount,
    hidden: c.hidden,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}
function childFromRemote(r: any): Child {
  return {
    id: r.id,
    name: r.name,
    dateOfBirth: r.date_of_birth,
    avatar: r.avatar,
    typicalBedtime: r.typical_bedtime,
    typicalWakeTime: r.typical_wake_time,
    typicalNapCount: r.typical_nap_count,
    hidden: r.hidden,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function sessionToRemote(s: SleepSession, familyId: string) {
  return {
    id: s.id,
    family_id: familyId,
    child_id: s.childId,
    start_time: s.startTime,
    end_time: s.endTime,
    excluded: s.excluded,
    logged_by: s.loggedBy,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    deleted_at: s.deletedAt,
  };
}
function sessionFromRemote(r: any): SleepSession {
  return {
    id: r.id,
    childId: r.child_id,
    startTime: r.start_time,
    endTime: r.end_time,
    excluded: r.excluded,
    loggedBy: r.logged_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function noteToRemote(n: DayNote, familyId: string) {
  return {
    id: n.id,
    family_id: familyId,
    child_id: n.childId,
    date: n.date,
    text: n.text,
    author: n.author,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
}
function noteFromRemote(r: any): DayNote {
  return {
    id: r.id,
    childId: r.child_id,
    date: r.date,
    text: r.text,
    author: r.author,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function mergeRemote<T extends { id: string; updatedAt: string }>(
  table: any,
  local: T | undefined,
  remoteRow: any,
  fromRemote: (r: any) => T,
): Promise<void> {
  const remote = fromRemote(remoteRow);
  if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
    await table.put(remote);
  }
}

/**
 * If concurrent logging on two devices ever leaves more than one open
 * (unended) session for the same child, keep the earliest-starting one and
 * soft-delete the rest — recoverable via the same 5-minute undo as any
 * other deletion, so a wrong auto-merge can still be corrected.
 */
async function dedupeOpenSessions(childId: string): Promise<void> {
  const sessions = await db.sessions.where("childId").equals(childId).toArray();
  const open = sessions.filter((s) => !s.deletedAt && s.endTime === null);
  if (open.length <= 1) return;
  open.sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const dup of open.slice(1)) {
    await db.sessions.update(dup.id, { deletedAt: nowIso(), updatedAt: nowIso() });
  }
}

/** Pushes every local row (small personal-scale dataset, so a full upsert each time is simplest) and pulls the family's remote state, merging by last-write-wins on updatedAt. */
export async function fullSync(): Promise<void> {
  if (!syncConfigured) return;
  const familyId = getFamilyId();
  if (!familyId) return;
  await ensureAnonymousSession();
  if (!supabase) return;

  const [caregivers, children, sessions, notes] = await Promise.all([
    db.caregivers.toArray(),
    db.children.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);

  if (caregivers.length) {
    await supabase.from("caregivers").upsert(caregivers.map((c) => caregiverToRemote(c, familyId)));
  }
  if (children.length) {
    await supabase.from("children").upsert(children.map((c) => childToRemote(c, familyId)));
  }
  if (sessions.length) {
    await supabase.from("sleep_sessions").upsert(sessions.map((s) => sessionToRemote(s, familyId)));
  }
  if (notes.length) {
    await supabase.from("day_notes").upsert(notes.map((n) => noteToRemote(n, familyId)));
  }

  const [remoteCaregivers, remoteChildren, remoteSessions, remoteNotes] = await Promise.all([
    supabase.from("caregivers").select("*").eq("family_id", familyId),
    supabase.from("children").select("*").eq("family_id", familyId),
    supabase.from("sleep_sessions").select("*").eq("family_id", familyId),
    supabase.from("day_notes").select("*").eq("family_id", familyId),
  ]);

  for (const row of remoteCaregivers.data ?? []) {
    const local = await db.caregivers.get(row.id);
    await mergeRemote(db.caregivers, local, row, caregiverFromRemote);
  }
  const touchedChildIds = new Set<string>();
  for (const row of remoteChildren.data ?? []) {
    const local = await db.children.get(row.id);
    await mergeRemote(db.children, local, row, childFromRemote);
  }
  for (const row of remoteSessions.data ?? []) {
    const local = await db.sessions.get(row.id);
    await mergeRemote(db.sessions, local, row, sessionFromRemote);
    touchedChildIds.add(row.child_id);
  }
  for (const row of remoteNotes.data ?? []) {
    const local = await db.notes.get(row.id);
    await mergeRemote(db.notes, local, row, noteFromRemote);
  }

  for (const childId of touchedChildIds) {
    await dedupeOpenSessions(childId);
  }
}

let autoSyncStarted = false;

/** Syncs on load, on reconnect, and periodically while online. Safe to call multiple times. */
export function startAutoSync(): void {
  if (autoSyncStarted || !syncConfigured || !hasJoinedFamily()) return;
  autoSyncStarted = true;

  fullSync().catch((err) => console.error("sync failed", err));
  window.addEventListener("online", () => {
    fullSync().catch((err) => console.error("sync failed", err));
  });
  setInterval(() => {
    if (navigator.onLine) fullSync().catch((err) => console.error("sync failed", err));
  }, 30_000);
}
