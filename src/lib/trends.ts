import type { Child, SleepSession } from "./types";
import { dayKeyForSession, isNightSession } from "./prediction";
import { todayKey } from "./timeline";

export interface DayStat {
  dateKey: string;
  totalMinutes: number; // naps + night combined
  nightMinutes: number; // night only, sum of segments (not the outer span)
  napCount: number;
}

/** One entry per day, oldest first, ending today. A night's sleep is attributed to the day it started. */
export function computeDailyStats(
  sessions: SleepSession[],
  child: Child,
  days: number,
  now: Date = new Date(),
): DayStat[] {
  const byDay = new Map<string, { total: number; night: number; napCount: number }>();

  for (const s of sessions) {
    if (s.deletedAt || s.excluded || !s.endTime) continue;
    const minutes = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
    if (minutes <= 0) continue;

    const key = dayKeyForSession(s, child);
    const entry = byDay.get(key) ?? { total: 0, night: 0, napCount: 0 };
    entry.total += minutes;
    if (isNightSession(s, child)) {
      entry.night += minutes;
    } else {
      entry.napCount += 1;
    }
    byDay.set(key, entry);
  }

  const result: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = todayKey(d);
    const entry = byDay.get(key);
    result.push({
      dateKey: key,
      totalMinutes: entry?.total ?? 0,
      nightMinutes: entry?.night ?? 0,
      napCount: entry?.napCount ?? 0,
    });
  }
  return result;
}

export interface TrendSummary {
  avgTotalHours: number | null;
  avgNightHours: number | null;
  avgNapsPerDay: number | null;
  daysWithData: number;
}

export function summarize(stats: DayStat[]): TrendSummary {
  const withData = stats.filter((s) => s.totalMinutes > 0);
  if (withData.length === 0) {
    return { avgTotalHours: null, avgNightHours: null, avgNapsPerDay: null, daysWithData: 0 };
  }
  const avgTotalHours = withData.reduce((sum, s) => sum + s.totalMinutes / 60, 0) / withData.length;
  const nightsWithData = withData.filter((s) => s.nightMinutes > 0);
  const avgNightHours = nightsWithData.length
    ? nightsWithData.reduce((sum, s) => sum + s.nightMinutes / 60, 0) / nightsWithData.length
    : null;
  const avgNapsPerDay = withData.reduce((sum, s) => sum + s.napCount, 0) / withData.length;
  return { avgTotalHours, avgNightHours, avgNapsPerDay, daysWithData: withData.length };
}
