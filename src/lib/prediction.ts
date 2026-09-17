import type { Child, SleepSession, SleepSlot } from "./types";

const AVG_DAYS_PER_MONTH = 30.4375;
const ROLLING_WINDOW_DAYS = 14;
const HALF_LIFE_DAYS = 5; // recency decay: an observation this many days old counts half as much
const GUARDRAIL_FACTOR = 0.4; // clamp to within +/-40% of the age baseline

export function ageInMonths(dateOfBirth: string, atDate: Date): number {
  const dob = new Date(dateOfBirth + "T00:00:00");
  const days = (atDate.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days / AVG_DAYS_PER_MONTH);
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- Sleep classification: night sleep vs. naps, via each child's own bedtime/wake window ---

export function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isNightTime(minutes: number, bedtimeMinutes: number, wakeMinutes: number): boolean {
  if (bedtimeMinutes > wakeMinutes) {
    // Typical case: the night window wraps past midnight (e.g. 19:30 -> 06:30).
    return minutes >= bedtimeMinutes || minutes < wakeMinutes;
  }
  // Unusual configuration (bedtime numerically before wake time) — treat as non-wrapping.
  return minutes >= bedtimeMinutes && minutes < wakeMinutes;
}

/** A session is night sleep if it *starts* within the child's bedtime->wake-time window. */
export function isNightSession(session: SleepSession, child: Child): boolean {
  const bedtimeMinutes = timeStringToMinutes(child.typicalBedtime);
  const wakeMinutes = timeStringToMinutes(child.typicalWakeTime);
  return isNightTime(minutesOfDay(new Date(session.startTime)), bedtimeMinutes, wakeMinutes);
}

/**
 * The calendar day a night session's *night* belongs to: a session starting
 * before the child's typical wake time is an early-morning continuation of
 * the previous night (e.g. a 1am resumption after a waking still belongs to
 * the night before). Naps don't need this — they never wrap midnight.
 */
function nightKeyFor(startTimeIso: string, wakeMinutes: number): string {
  const d = new Date(startTimeIso);
  if (minutesOfDay(d) < wakeMinutes) {
    return localDateKey(new Date(d.getTime() - 24 * 60 * 60 * 1000));
  }
  return localDateKey(d);
}

/** The day a session should be grouped under for review/exclusion/trends purposes. */
export function dayKeyForSession(session: SleepSession, child: Child): string {
  if (isNightSession(session, child)) {
    return nightKeyFor(session.startTime, timeStringToMinutes(child.typicalWakeTime));
  }
  return localDateKey(new Date(session.startTime));
}

function ordinalToNapSlot(index: number): SleepSlot {
  const capped = Math.min(Math.max(index, 0), 3);
  return (["nap1", "nap2", "nap3", "nap4"] as const)[capped];
}

/** Assigns each session a slot: naps are numbered by order within their day, capped at nap4; any night session is "bedtime". */
export function classifySessions(sortedSessions: SleepSession[], child: Child): Map<string, SleepSlot> {
  const slotBySessionId = new Map<string, SleepSlot>();
  const napsCountByDay = new Map<string, number>();
  for (const session of sortedSessions) {
    if (isNightSession(session, child)) {
      slotBySessionId.set(session.id, "bedtime");
    } else {
      const dayKey = localDateKey(new Date(session.startTime));
      const priorToday = napsCountByDay.get(dayKey) ?? 0;
      slotBySessionId.set(session.id, ordinalToNapSlot(priorToday));
      napsCountByDay.set(dayKey, priorToday + 1);
    }
  }
  return slotBySessionId;
}

// --- Age-based baselines ---

interface AgeBracket<T> {
  maxAgeMonths: number; // upper bound, exclusive (Infinity for the last bracket)
  value: T;
}

function lookupBracket<T>(brackets: AgeBracket<T>[], ageMonths: number): T {
  const bracket = brackets.find((b) => ageMonths < b.maxAgeMonths);
  return (bracket ?? brackets[brackets.length - 1]).value;
}

// Wake window (time spent awake before the next sleep), minutes, midpoint of each spec'd range.
const WAKE_WINDOW_BASELINES: AgeBracket<number>[] = [
  { maxAgeMonths: 2, value: 52.5 }, // 45-60min
  { maxAgeMonths: 3, value: 75 }, // 60-90min
  { maxAgeMonths: 4, value: 105 }, // 1.5-2hr
  { maxAgeMonths: 6, value: 135 }, // 2-2.5hr
  { maxAgeMonths: 9, value: 180 }, // 2.5-3.5hr
  { maxAgeMonths: 12, value: 210 }, // 3-4hr
  { maxAgeMonths: 18, value: 270 }, // 4-5hr
  { maxAgeMonths: 24, value: 330 }, // 5-6hr
  { maxAgeMonths: 30, value: 360 }, // 5.5-6.5hr
  { maxAgeMonths: 36, value: 390 }, // 6-7hr
  { maxAgeMonths: Infinity, value: 390 }, // 6-7hr, typically bedtime-only
];

export function ageBaselineMinutes(ageMonths: number): number {
  return lookupBracket(WAKE_WINDOW_BASELINES, ageMonths);
}

// Night sleep duration baseline (total across the night), minutes.
const NIGHT_DURATION_BASELINES: AgeBracket<number>[] = [
  { maxAgeMonths: 2, value: 510 }, // ~8.5hr
  { maxAgeMonths: 4, value: 570 }, // ~9.5hr
  { maxAgeMonths: 6, value: 630 }, // ~10.5hr
  { maxAgeMonths: 12, value: 660 }, // ~11hr
  { maxAgeMonths: 24, value: 690 }, // ~11.5hr
  { maxAgeMonths: 36, value: 660 }, // ~11hr
  { maxAgeMonths: Infinity, value: 630 }, // ~10.5hr
];

// Nap duration baseline (a single typical nap), minutes, before per-slot adjustment below.
// The spec gives illustrative examples (nap1 ~60-90min, nap2 ~45-60min) rather than a full
// table; this approximates that pattern across ages rather than reproducing exact figures.
const NAP_DURATION_BASELINES: AgeBracket<number>[] = [
  { maxAgeMonths: 4, value: 60 },
  { maxAgeMonths: 9, value: 75 },
  { maxAgeMonths: 18, value: 75 },
  { maxAgeMonths: 36, value: 105 },
  { maxAgeMonths: Infinity, value: 90 },
];

const NAP_SLOT_ADJUSTMENT_MINUTES: Record<string, number> = {
  nap1: 15,
  nap2: 0,
  nap3: -15,
  nap4: -20,
};

const MIN_NAP_DURATION_MINUTES = 20;

function durationBaselineMinutes(ageMonths: number, slot: SleepSlot): number {
  if (slot === "bedtime") return lookupBracket(NIGHT_DURATION_BASELINES, ageMonths);
  const base = lookupBracket(NAP_DURATION_BASELINES, ageMonths);
  return Math.max(MIN_NAP_DURATION_MINUTES, base + NAP_SLOT_ADJUSTMENT_MINUTES[slot]);
}

// --- Shared rolling/recency-weighted average, outlier exclusion, blend, guardrail ---

interface Observation {
  slot: SleepSlot;
  minutes: number;
  observedAt: Date;
  excluded: boolean;
}

function recencyWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

interface AverageResult {
  minutes: number | null;
  daysOfData: number;
}

function personalAverageForSlot(
  observations: Observation[],
  slot: SleepSlot,
  outlierBaseline: number,
  now: Date,
): AverageResult {
  const windowStart = now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const daysWithAnyData = new Set<string>();
  let weightedSum = 0;
  let weightTotal = 0;

  for (const obs of observations) {
    const t = obs.observedAt.getTime();
    if (t < windowStart || t > now.getTime()) continue;
    if (obs.excluded) continue;

    daysWithAnyData.add(localDateKey(obs.observedAt));

    if (obs.slot !== slot) continue;
    if (obs.minutes < 10 || obs.minutes > 2 * outlierBaseline) continue;

    const ageDays = (now.getTime() - t) / (1000 * 60 * 60 * 24);
    const weight = recencyWeight(ageDays);
    weightedSum += obs.minutes * weight;
    weightTotal += weight;
  }

  return { minutes: weightTotal > 0 ? weightedSum / weightTotal : null, daysOfData: daysWithAnyData.size };
}

function blendWeights(daysOfData: number): { personal: number; baseline: number } {
  if (daysOfData >= 14) return { personal: 0.9, baseline: 0.1 };
  if (daysOfData >= 7) return { personal: 0.75, baseline: 0.25 };
  if (daysOfData >= 3) return { personal: 0.5, baseline: 0.5 };
  return { personal: 0.2, baseline: 0.8 };
}

function blendAndClamp(personalMinutes: number | null, baseline: number, daysOfData: number): number {
  const weights = blendWeights(daysOfData);
  const blended = personalMinutes !== null ? personalMinutes * weights.personal + baseline * weights.baseline : baseline;
  const min = baseline * (1 - GUARDRAIL_FACTOR);
  const max = baseline * (1 + GUARDRAIL_FACTOR);
  return Math.min(max, Math.max(min, blended));
}

// --- Algorithm A: wind-down time (when to put them down next) ---

export interface WindDownPrediction {
  slot: SleepSlot;
  wakeWindowMinutes: number;
  predictedTime: Date;
  lastWakeUpTime: Date;
  daysOfData: number;
}

function computeWakeWindowObservations(sortedSessions: SleepSession[], child: Child): Observation[] {
  const slotBySessionId = classifySessions(sortedSessions, child);
  const observations: Observation[] = [];
  for (let i = 1; i < sortedSessions.length; i++) {
    const session = sortedSessions[i];
    const prev = sortedSessions[i - 1];
    if (!prev.endTime) continue;
    const minutes = (new Date(session.startTime).getTime() - new Date(prev.endTime).getTime()) / 60000;
    if (minutes <= 0) continue;
    observations.push({
      slot: slotBySessionId.get(session.id)!,
      minutes,
      observedAt: new Date(session.startTime),
      excluded: session.excluded,
    });
  }
  return observations;
}

export function predictWindDown(
  child: Child,
  sessions: SleepSession[],
  now: Date = new Date(),
): WindDownPrediction | null {
  const sorted = sessions
    .filter((s) => s.childId === child.id && !s.deletedAt)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const running = sorted.find((s) => s.endTime === null);
  if (running) return null; // no wind-down prediction while asleep — see predictEstimatedWake instead

  const lastFinished = [...sorted].reverse().find((s) => s.endTime !== null);
  if (!lastFinished?.endTime) return null;

  const lastWakeUpTime = new Date(lastFinished.endTime);
  const todayKey = localDateKey(lastWakeUpTime);
  const napsSoFarToday = sorted.filter(
    (s) => !isNightSession(s, child) && localDateKey(new Date(s.startTime)) === todayKey,
  ).length;

  const slot: SleepSlot = napsSoFarToday < child.typicalNapCount ? ordinalToNapSlot(napsSoFarToday) : "bedtime";

  const ageMonths = ageInMonths(child.dateOfBirth, now);
  const baseline = ageBaselineMinutes(ageMonths);

  const observations = computeWakeWindowObservations(sorted, child);
  const { minutes: personalMinutes, daysOfData } = personalAverageForSlot(observations, slot, baseline, now);
  const wakeWindowMinutes = blendAndClamp(personalMinutes, baseline, daysOfData);

  return {
    slot,
    wakeWindowMinutes,
    predictedTime: new Date(lastWakeUpTime.getTime() + wakeWindowMinutes * 60000),
    lastWakeUpTime,
    daysOfData,
  };
}

// --- Algorithm B: estimated wake time (while asleep) ---

export interface EstimatedWakeRange {
  slot: SleepSlot;
  rangeStart: Date;
  rangeEnd: Date;
  daysOfData: number;
}

const DISPLAY_RANGE_FACTOR = 0.2; // +/-20% band around the point estimate, for display only

export function predictEstimatedWake(
  child: Child,
  sessions: SleepSession[],
  now: Date = new Date(),
): EstimatedWakeRange | null {
  const sorted = sessions
    .filter((s) => s.childId === child.id && !s.deletedAt)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const running = sorted.find((s) => s.endTime === null);
  if (!running) return null;

  const slotBySessionId = classifySessions(sorted, child);
  const slot = slotBySessionId.get(running.id)!;
  const ageMonths = ageInMonths(child.dateOfBirth, now);

  let outlierBaseline = durationBaselineMinutes(ageMonths, slot);

  if (slot === "bedtime") {
    const wakeMinutes = timeStringToMinutes(child.typicalWakeTime);
    const nightKey = nightKeyFor(running.startTime, wakeMinutes);
    const priorSegmentsMinutes = sorted
      .filter(
        (s) =>
          s.id !== running.id &&
          s.endTime &&
          isNightSession(s, child) &&
          nightKeyFor(s.startTime, wakeMinutes) === nightKey &&
          s.startTime < running.startTime,
      )
      .reduce((sum, s) => sum + (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 60000, 0);
    outlierBaseline = Math.max(MIN_NAP_DURATION_MINUTES, outlierBaseline - priorSegmentsMinutes);
  }

  const durationObservations: Observation[] = [];
  for (const session of sorted) {
    if (!session.endTime || session.id === running.id) continue;
    const minutes = (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000;
    if (minutes <= 0) continue;
    durationObservations.push({
      slot: slotBySessionId.get(session.id)!,
      minutes,
      observedAt: new Date(session.startTime),
      excluded: session.excluded,
    });
  }

  const { minutes: personalMinutes, daysOfData } = personalAverageForSlot(
    durationObservations,
    slot,
    outlierBaseline,
    now,
  );
  const blended = blendAndClamp(personalMinutes, outlierBaseline, daysOfData);

  const start = new Date(running.startTime);
  const pointEstimate = start.getTime() + blended * 60000;
  const halfBand = blended * DISPLAY_RANGE_FACTOR * 60000;

  return {
    slot,
    rangeStart: new Date(pointEstimate - halfBand),
    rangeEnd: new Date(pointEstimate + halfBand),
    daysOfData,
  };
}

// --- Trends helper: night sleep is the sum of segments within a night, not the outer span ---

export function nightSleepTotalMinutes(sessions: SleepSession[], child: Child, nightDateKey: string): number {
  const wakeMinutes = timeStringToMinutes(child.typicalWakeTime);
  return sessions
    .filter(
      (s) =>
        s.childId === child.id &&
        !s.deletedAt &&
        !s.excluded &&
        s.endTime &&
        isNightSession(s, child) &&
        nightKeyFor(s.startTime, wakeMinutes) === nightDateKey,
    )
    .reduce((sum, s) => sum + (new Date(s.endTime!).getTime() - new Date(s.startTime).getTime()) / 60000, 0);
}
