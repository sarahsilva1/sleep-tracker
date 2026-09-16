import type { Child, SleepSession, SleepSlot } from "./types";

// --- 1. Age-based baseline (minutes), using the midpoint of each range ---

interface AgeBaseline {
  maxAgeMonths: number; // upper bound, exclusive (Infinity for the last bracket)
  wakeWindowMinutes: number; // midpoint of the spec'd range
}

const AGE_BASELINES: AgeBaseline[] = [
  { maxAgeMonths: 2, wakeWindowMinutes: 52.5 }, // 0-2mo: 45-60min
  { maxAgeMonths: 3, wakeWindowMinutes: 75 }, // 2-3mo: 60-90min
  { maxAgeMonths: 4, wakeWindowMinutes: 105 }, // 3-4mo: 1.5-2hr
  { maxAgeMonths: 6, wakeWindowMinutes: 135 }, // 4-6mo: 2-2.5hr
  { maxAgeMonths: 9, wakeWindowMinutes: 180 }, // 6-9mo: 2.5-3.5hr
  { maxAgeMonths: 12, wakeWindowMinutes: 210 }, // 9-12mo: 3-4hr
  { maxAgeMonths: 18, wakeWindowMinutes: 270 }, // 12-18mo: 4-5hr
  { maxAgeMonths: Infinity, wakeWindowMinutes: 330 }, // 18+mo: 5-6hr
];

const AVG_DAYS_PER_MONTH = 30.4375;

export function ageInMonths(dateOfBirth: string, atDate: Date): number {
  const dob = new Date(dateOfBirth + "T00:00:00");
  const days = (atDate.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days / AVG_DAYS_PER_MONTH);
}

export function ageBaselineMinutes(ageMonths: number): number {
  const bracket = AGE_BASELINES.find((b) => ageMonths < b.maxAgeMonths);
  return (bracket ?? AGE_BASELINES[AGE_BASELINES.length - 1]).wakeWindowMinutes;
}

// --- 2. Per-time-slot classification ---
//
// Slot is assigned by ordinal position among a child's sleep sessions that
// started on the same local calendar day: the 1st sleep of the day is
// "nap1", 2nd is "nap2", 3rd is "nap3", and a 4th+ is "bedtime". This is a
// simple approximation, not a lookahead-based "is this actually the last
// sleep of the day" classification — for a one-nap toddler, the true
// bedtime sleep will be labeled "nap2". That's an accepted tradeoff: the
// same rule is applied consistently when both recording history and
// predicting the next slot, so personal averages stay self-consistent even
// though the label doesn't always match what a human would call it.
function ordinalToSlot(priorSessionsToday: number): SleepSlot {
  if (priorSessionsToday === 0) return "nap1";
  if (priorSessionsToday === 1) return "nap2";
  if (priorSessionsToday === 2) return "nap3";
  return "bedtime";
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface WakeWindowObservation {
  slot: SleepSlot;
  minutes: number;
  observedAt: Date; // the start time of the sleep session that ended this wake window
  excluded: boolean;
}

/** Derives one wake-window observation per sleep session that has a preceding, ended session. */
function computeWakeWindowObservations(sessions: SleepSession[]): WakeWindowObservation[] {
  const sorted = [...sessions]
    .filter((s) => !s.deleted)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const observations: WakeWindowObservation[] = [];
  const sessionsTodayCount = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const session = sorted[i];
    const dayKey = localDateKey(session.startTime);
    const priorToday = sessionsTodayCount.get(dayKey) ?? 0;
    const slot = ordinalToSlot(priorToday);
    sessionsTodayCount.set(dayKey, priorToday + 1);

    const prev = sorted[i - 1];
    if (prev && prev.endTime) {
      const minutes = (new Date(session.startTime).getTime() - new Date(prev.endTime).getTime()) / 60000;
      if (minutes > 0) {
        observations.push({
          slot,
          minutes,
          observedAt: new Date(session.startTime),
          excluded: session.excluded,
        });
      }
    }
  }

  return observations;
}

// --- 3. Personal average (rolling 14-day, recency-weighted, outlier-excluded) ---

const ROLLING_WINDOW_DAYS = 14;
const HALF_LIFE_DAYS = 5; // recency decay: a wake window this many days old counts half as much

function recencyWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

interface PersonalAverageResult {
  minutes: number | null;
  daysOfData: number;
}

function personalAverageForSlot(
  observations: WakeWindowObservation[],
  slot: SleepSlot,
  ageBaseline: number,
  now: Date,
): PersonalAverageResult {
  const windowStart = now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const daysWithAnyData = new Set<string>();
  let weightedSum = 0;
  let weightTotal = 0;

  for (const obs of observations) {
    const t = obs.observedAt.getTime();
    if (t < windowStart || t > now.getTime()) continue;
    if (obs.excluded) continue;

    daysWithAnyData.add(localDateKey(obs.observedAt.toISOString()));

    if (obs.slot !== slot) continue;
    if (obs.minutes < 10 || obs.minutes > 2 * ageBaseline) continue; // implausible outlier

    const ageDays = (now.getTime() - t) / (1000 * 60 * 60 * 24);
    const weight = recencyWeight(ageDays);
    weightedSum += obs.minutes * weight;
    weightTotal += weight;
  }

  return {
    minutes: weightTotal > 0 ? weightedSum / weightTotal : null,
    daysOfData: daysWithAnyData.size,
  };
}

// --- 4. Blend weighting ---

function blendWeights(daysOfData: number): { personal: number; baseline: number } {
  if (daysOfData >= 14) return { personal: 0.9, baseline: 0.1 };
  if (daysOfData >= 7) return { personal: 0.75, baseline: 0.25 };
  if (daysOfData >= 3) return { personal: 0.5, baseline: 0.5 };
  return { personal: 0.2, baseline: 0.8 };
}

// --- 5 & 6. Guardrail + final prediction ---

export interface SweetSpotPrediction {
  slot: SleepSlot;
  wakeWindowMinutes: number;
  predictedTime: Date;
  lastWakeUpTime: Date;
  daysOfData: number;
}

export function predictNextSleep(
  child: Child,
  sessions: SleepSession[],
  overrides: Map<SleepSlot, number>,
  now: Date = new Date(),
): SweetSpotPrediction | null {
  const relevant = sessions.filter((s) => s.childId === child.id && !s.deleted);
  const sorted = [...relevant].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Find the last wake-up: the end time of the most recent finished session,
  // or now, if a session is currently running (no prediction while asleep).
  const running = sorted.find((s) => s.endTime === null);
  if (running) return null;

  const lastFinished = [...sorted].reverse().find((s) => s.endTime !== null);
  if (!lastFinished || !lastFinished.endTime) return null;

  const lastWakeUpTime = new Date(lastFinished.endTime);
  const dayKey = localDateKey(lastWakeUpTime.toISOString());
  const sessionsStartedSameDay = sorted.filter(
    (s) => localDateKey(s.startTime) === dayKey && s.startTime <= lastFinished.startTime,
  ).length;
  const slot = ordinalToSlot(sessionsStartedSameDay - 1);

  const ageMonths = ageInMonths(child.dateOfBirth, now);
  const baseline = ageBaselineMinutes(ageMonths);

  if (overrides.has(slot)) {
    const minutes = overrides.get(slot)!;
    return {
      slot,
      wakeWindowMinutes: minutes,
      predictedTime: new Date(lastWakeUpTime.getTime() + minutes * 60000),
      lastWakeUpTime,
      daysOfData: 0,
    };
  }

  const observations = computeWakeWindowObservations(sorted);
  const { minutes: personalMinutes, daysOfData } = personalAverageForSlot(observations, slot, baseline, now);
  const weights = blendWeights(daysOfData);

  const blended =
    personalMinutes !== null
      ? personalMinutes * weights.personal + baseline * weights.baseline
      : baseline;

  const min = baseline * 0.6;
  const max = baseline * 1.4;
  const clamped = Math.min(max, Math.max(min, blended));

  return {
    slot,
    wakeWindowMinutes: clamped,
    predictedTime: new Date(lastWakeUpTime.getTime() + clamped * 60000),
    lastWakeUpTime,
    daysOfData,
  };
}
