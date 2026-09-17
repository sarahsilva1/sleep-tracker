import { db } from "./db";
import type { Child, Caregiver, SleepSession, DayNote } from "./types";

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function exportCsv(): Promise<void> {
  const [children, caregivers, sessions, notes] = await Promise.all([
    db.children.toArray(),
    db.caregivers.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);
  const childName = new Map(children.map((c) => [c.id, c.name]));
  const caregiverName = new Map(caregivers.map((c) => [c.id, c.firstName]));
  const nameFor = (id: string | null) => (id ? (caregiverName.get(id) ?? "Removed caregiver") : "Imported");

  const sessionRows = [["child", "start", "end", "duration_minutes", "excluded", "logged_by"]];
  for (const s of sessions.filter((s) => !s.deletedAt)) {
    const durationMinutes = s.endTime
      ? Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)
      : "";
    sessionRows.push([
      childName.get(s.childId) ?? s.childId,
      s.startTime,
      s.endTime ?? "",
      String(durationMinutes),
      String(s.excluded),
      nameFor(s.loggedBy),
    ]);
  }
  const sessionsCsv = sessionRows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob("sleep-sessions.csv", sessionsCsv, "text/csv");

  const noteRows = [["child", "date", "note", "author"]];
  for (const n of notes) {
    noteRows.push([childName.get(n.childId) ?? n.childId, n.date, n.text, nameFor(n.author)]);
  }
  const notesCsv = noteRows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob("day-notes.csv", notesCsv, "text/csv");
}

interface ExportPayload {
  exportedAt: string;
  children: Child[];
  caregivers: Caregiver[];
  sessions: SleepSession[];
  notes: DayNote[];
}

export async function exportJson(): Promise<void> {
  const [children, caregivers, sessions, notes] = await Promise.all([
    db.children.toArray(),
    db.caregivers.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);
  const payload: ExportPayload = {
    exportedAt: new Date().toISOString(),
    children,
    caregivers,
    sessions: sessions.filter((s) => !s.deletedAt),
    notes,
  };
  downloadBlob("sleep-tracker-export.json", JSON.stringify(payload, null, 2), "application/json");
}

export interface ImportSummary {
  childrenAdded: number;
  caregiversAdded: number;
  sessionsAdded: number;
  sessionsSkipped: number;
  notesAdded: number;
}

/** Additive import from this app's own JSON export: dedupes by id, keeping whichever copy has the newer updatedAt. */
export async function importJson(text: string): Promise<ImportSummary> {
  const payload = JSON.parse(text) as Partial<ExportPayload>;
  const summary: ImportSummary = { childrenAdded: 0, caregiversAdded: 0, sessionsAdded: 0, sessionsSkipped: 0, notesAdded: 0 };

  async function mergeInto<T extends { id: string; updatedAt: string }>(
    table: typeof db.children | typeof db.caregivers | typeof db.sessions | typeof db.notes,
    rows: T[] | undefined,
  ): Promise<number> {
    let added = 0;
    for (const row of rows ?? []) {
      const existing = await (table as any).get(row.id);
      if (!existing) {
        added++;
        await (table as any).put(row);
      } else if (new Date(row.updatedAt) > new Date(existing.updatedAt)) {
        await (table as any).put(row);
      }
    }
    return added;
  }

  summary.caregiversAdded = await mergeInto(db.caregivers, payload.caregivers);
  summary.childrenAdded = await mergeInto(db.children, payload.children);
  summary.notesAdded = await mergeInto(db.notes, payload.notes);

  for (const session of payload.sessions ?? []) {
    if (!session.childId || !session.startTime) {
      summary.sessionsSkipped++;
      continue;
    }
    const existing = await db.sessions.get(session.id);
    if (!existing) {
      summary.sessionsAdded++;
      await db.sessions.put(session);
    } else if (new Date(session.updatedAt) > new Date(existing.updatedAt)) {
      await db.sessions.put(session);
    }
  }

  return summary;
}
