import { supabase, syncConfigured } from "./supabaseClient";
import { db } from "./db";
import type { Child, SleepSession, DayNote } from "./types";

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
  if (error || !data) throw error ?? new Error("Invalid setup code");
  setFamilyId(data);
}

// --- Row mapping (camelCase local <-> snake_case remote) ---

function childToRemote(c: Child, familyId: string) {
  return {
    id: c.id,
    family_id: familyId,
    name: c.name,
    date_of_birth: c.dateOfBirth,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    deleted: c.deleted ?? false,
  };
}
function childFromRemote(r: any): Child {
  return {
    id: r.id,
    name: r.name,
    dateOfBirth: r.date_of_birth,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted,
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
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    deleted: s.deleted ?? false,
  };
}
function sessionFromRemote(r: any): SleepSession {
  return {
    id: r.id,
    childId: r.child_id,
    startTime: r.start_time,
    endTime: r.end_time,
    excluded: r.excluded,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted,
  };
}

function noteToRemote(n: DayNote, familyId: string) {
  return {
    id: n.id,
    family_id: familyId,
    child_id: n.childId,
    date: n.date,
    text: n.text,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    deleted: n.deleted ?? false,
  };
}
function noteFromRemote(r: any): DayNote {
  return {
    id: r.id,
    childId: r.child_id,
    date: r.date,
    text: r.text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted,
  };
}

async function mergeRemote<T extends { id: string; updatedAt: string }>(
  table: any,
  local: T,
  remoteRow: any,
  fromRemote: (r: any) => T,
): Promise<void> {
  const remote = fromRemote(remoteRow);
  if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
    await table.put(remote);
  }
}

/** Pushes every local row (small personal-scale dataset, so a full upsert each time is simplest) and pulls the family's remote state, merging by last-write-wins on updatedAt. */
export async function fullSync(): Promise<void> {
  if (!syncConfigured) return;
  const familyId = getFamilyId();
  if (!familyId) return;
  await ensureAnonymousSession();
  if (!supabase) return;

  const [children, sessions, notes] = await Promise.all([
    db.children.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);

  if (children.length) {
    await supabase.from("children").upsert(children.map((c) => childToRemote(c, familyId)));
  }
  if (sessions.length) {
    await supabase.from("sleep_sessions").upsert(sessions.map((s) => sessionToRemote(s, familyId)));
  }
  if (notes.length) {
    await supabase.from("day_notes").upsert(notes.map((n) => noteToRemote(n, familyId)));
  }

  const [remoteChildren, remoteSessions, remoteNotes] = await Promise.all([
    supabase.from("children").select("*").eq("family_id", familyId),
    supabase.from("sleep_sessions").select("*").eq("family_id", familyId),
    supabase.from("day_notes").select("*").eq("family_id", familyId),
  ]);

  for (const row of remoteChildren.data ?? []) {
    const local = await db.children.get(row.id);
    await mergeRemote(db.children, local as Child, row, childFromRemote);
  }
  for (const row of remoteSessions.data ?? []) {
    const local = await db.sessions.get(row.id);
    await mergeRemote(db.sessions, local as SleepSession, row, sessionFromRemote);
  }
  for (const row of remoteNotes.data ?? []) {
    const local = await db.notes.get(row.id);
    await mergeRemote(db.notes, local as DayNote, row, noteFromRemote);
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
