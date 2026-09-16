import { db } from "./db";

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
  const [children, sessions, notes] = await Promise.all([
    db.children.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);
  const childName = new Map(children.map((c) => [c.id, c.name]));

  const sessionRows = [["child", "start", "end", "duration_minutes", "excluded"]];
  for (const s of sessions.filter((s) => !s.deleted)) {
    const durationMinutes = s.endTime
      ? Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)
      : "";
    sessionRows.push([
      childName.get(s.childId) ?? s.childId,
      s.startTime,
      s.endTime ?? "",
      String(durationMinutes),
      String(s.excluded),
    ]);
  }
  const sessionsCsv = sessionRows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob("sleep-sessions.csv", sessionsCsv, "text/csv");

  const noteRows = [["child", "date", "note"]];
  for (const n of notes.filter((n) => !n.deleted)) {
    noteRows.push([childName.get(n.childId) ?? n.childId, n.date, n.text]);
  }
  const notesCsv = noteRows.map((r) => r.map(csvEscape).join(",")).join("\n");
  downloadBlob("day-notes.csv", notesCsv, "text/csv");
}

export async function exportJson(): Promise<void> {
  const [children, sessions, notes] = await Promise.all([
    db.children.toArray(),
    db.sessions.toArray(),
    db.notes.toArray(),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    children: children.filter((c) => !c.deleted),
    sessions: sessions.filter((s) => !s.deleted),
    notes: notes.filter((n) => !n.deleted),
  };
  downloadBlob("sleep-tracker-export.json", JSON.stringify(payload, null, 2), "application/json");
}
