import type { SleepSession } from "./types";

export interface TimelineSegment {
  type: "asleep" | "awake";
  widthFraction: number; // 0-1, relative to the visible span
}

/** Builds today's awake/asleep blocks from local midnight through `until` (now, for the current day). */
export function buildDayTimeline(dateKey: string, sessions: SleepSession[], until: Date): TimelineSegment[] {
  const dayStart = new Date(dateKey + "T00:00:00");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const visibleEnd = until < dayEnd ? until : dayEnd;
  const totalMs = visibleEnd.getTime() - dayStart.getTime();
  if (totalMs <= 0) return [];

  const relevant = sessions
    .filter((s) => !s.deletedAt)
    .map((s) => ({
      start: new Date(s.startTime),
      end: s.endTime ? new Date(s.endTime) : until,
    }))
    .filter((s) => s.start < visibleEnd && s.end > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const segments: TimelineSegment[] = [];
  let cursor = dayStart;

  for (const s of relevant) {
    const clippedStart = s.start < dayStart ? dayStart : s.start;
    const clippedEnd = s.end > visibleEnd ? visibleEnd : s.end;
    if (clippedStart > cursor) {
      segments.push({ type: "awake", widthFraction: (clippedStart.getTime() - cursor.getTime()) / totalMs });
    }
    if (clippedEnd > clippedStart) {
      segments.push({ type: "asleep", widthFraction: (clippedEnd.getTime() - clippedStart.getTime()) / totalMs });
      cursor = clippedEnd;
    }
  }

  if (cursor < visibleEnd) {
    segments.push({ type: "awake", widthFraction: (visibleEnd.getTime() - cursor.getTime()) / totalMs });
  }

  return segments;
}

export function todayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
