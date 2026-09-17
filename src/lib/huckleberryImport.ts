import { db, newId, nowIso } from "./db";
import { dayKeyForSession } from "./prediction";
import type { Child, SleepSession } from "./types";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Converts a bare local wall-clock time in a given IANA timezone to a UTC Date, DST-aware. */
export function wallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const naiveGuess = new Date(`${dateStr}T${timeStr}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  function readAsUtc(d: Date): Date {
    const parts = formatter.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return new Date(Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second));
  }
  let guess = naiveGuess;
  for (let i = 0; i < 3; i++) {
    const delta = naiveGuess.getTime() - readAsUtc(guess).getTime();
    if (delta === 0) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

export interface HuckleberryImportOptions {
  childId: string;
  timeZone: string;
}

export interface HuckleberryImportResult {
  totalRows: number;
  nonSleepIgnored: number;
  duplicatesSkipped: number;
  missingEndSkipped: number;
  overlapsSkipped: number;
  imported: number;
  notesImported: number;
}

interface ParsedRow {
  start: Date;
  end: Date;
  notes: string;
}

export async function importHuckleberryCsv(
  csvText: string,
  options: HuckleberryImportOptions,
): Promise<HuckleberryImportResult> {
  const rows = parseCsv(csvText);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const idx = (name: string) => header.indexOf(name);
  const typeIdx = idx("Type");
  const startIdx = idx("Start");
  const endIdx = idx("End");
  const notesIdx = idx("Notes");

  const result: HuckleberryImportResult = {
    totalRows: rows.length - 1,
    nonSleepIgnored: 0,
    duplicatesSkipped: 0,
    missingEndSkipped: 0,
    overlapsSkipped: 0,
    imported: 0,
    notesImported: 0,
  };

  const seenExact = new Set<string>();
  const parsed: ParsedRow[] = [];

  for (const row of rows.slice(1)) {
    if (row.length <= 1) continue;
    const type = row[typeIdx]?.trim();
    if (type !== "Sleep") {
      result.nonSleepIgnored++;
      continue;
    }
    const startRaw = row[startIdx]?.trim();
    const endRaw = row[endIdx]?.trim();
    if (!startRaw || !endRaw) {
      result.missingEndSkipped++;
      continue;
    }
    const exactKey = `${startRaw}|${endRaw}`;
    if (seenExact.has(exactKey)) {
      result.duplicatesSkipped++;
      continue;
    }
    seenExact.add(exactKey);

    const [startDate, startTime] = startRaw.split(" ");
    const [endDate, endTime] = endRaw.split(" ");
    const start = wallTimeToUtc(startDate, startTime, options.timeZone);
    const end = wallTimeToUtc(endDate, endTime, options.timeZone);
    if (end <= start) {
      result.missingEndSkipped++;
      continue;
    }

    parsed.push({ start, end, notes: row[notesIdx]?.trim() ?? "" });
  }

  parsed.sort((a, b) => a.start.getTime() - b.start.getTime());

  const accepted: ParsedRow[] = [];
  let cursor: Date | null = null;
  for (const row of parsed) {
    if (cursor && row.start < cursor) {
      result.overlapsSkipped++;
      continue;
    }
    accepted.push(row);
    cursor = row.end;
  }

  const child = await db.children.get(options.childId);
  if (!child) throw new Error("Child not found");

  for (const row of accepted) {
    const session: SleepSession = {
      id: newId(),
      childId: options.childId,
      startTime: row.start.toISOString(),
      endTime: row.end.toISOString(),
      excluded: false,
      loggedBy: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    await db.sessions.put(session);
    result.imported++;

    if (row.notes) {
      const dateKey = dayKeyForSession(session, child as Child);
      const existing = await db.notes.where("[childId+date]").equals([options.childId, dateKey]).first();
      if (existing) {
        await db.notes.update(existing.id, {
          text: existing.text ? `${existing.text}\n${row.notes}` : row.notes,
          updatedAt: nowIso(),
        });
      } else {
        await db.notes.put({
          id: newId(),
          childId: options.childId,
          date: dateKey,
          text: row.notes,
          author: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        result.notesImported++;
      }
    }
  }

  return result;
}
