import type { SleepSession } from "./types";
import { todayKey } from "./timeline";

export interface DayStat {
  dateKey: string;
  totalMinutes: number;
  longestMinutes: number;
  sessionCount: number;
}

function localKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One entry per day, oldest first, ending today. Sessions are attributed to the local day they started on. */
export function computeDailyStats(sessions: SleepSession[], days: number, now: Date = new Date()): DayStat[] {
  const byDay = new Map<string, { total: number; longest: number; count: number }>();

  for (const s of sessions) {
    if (s.deleted || s.excluded) continue;
    const durationMs = (s.endTime ? new Date(s.endTime).getTime() : now.getTime()) - new Date(s.startTime).getTime();
    if (durationMs <= 0) continue;
    const key = localKey(s.startTime);
    const entry = byDay.get(key) ?? { total: 0, longest: 0, count: 0 };
    const durationMinutes = durationMs / 60000;
    entry.total += durationMinutes;
    entry.longest = Math.max(entry.longest, durationMinutes);
    entry.count += 1;
    byDay.set(key, entry);
  }

  const result: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = todayKey(d);
    const entry = byDay.get(key);
    result.push({
      dateKey: key,
      totalMinutes: entry ? entry.total : 0,
      longestMinutes: entry ? entry.longest : 0,
      sessionCount: entry?.count ?? 0,
    });
  }
  return result;
}

export interface TrendSummary {
  avgTotalHours: number | null;
  avgLongestHours: number | null;
  avgSessionsPerDay: number | null;
  daysWithData: number;
}

export function summarize(stats: DayStat[]): TrendSummary {
  const withData = stats.filter((s) => s.sessionCount > 0);
  if (withData.length === 0) {
    return { avgTotalHours: null, avgLongestHours: null, avgSessionsPerDay: null, daysWithData: 0 };
  }
  const avgTotalHours = withData.reduce((sum, s) => sum + s.totalMinutes / 60, 0) / withData.length;
  const avgLongestHours = withData.reduce((sum, s) => sum + s.longestMinutes / 60, 0) / withData.length;
  const avgSessionsPerDay = withData.reduce((sum, s) => sum + s.sessionCount, 0) / withData.length;
  return { avgTotalHours, avgLongestHours, avgSessionsPerDay, daysWithData: withData.length };
}
