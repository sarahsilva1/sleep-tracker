export interface Child {
  id: string;
  name: string;
  dateOfBirth: string; // YYYY-MM-DD
  avatar: string | null; // initials (e.g. "JS") or a single emoji
  typicalBedtime: string; // "HH:MM", 24h local time-of-day, no timezone
  typicalWakeTime: string; // "HH:MM", 24h local time-of-day, no timezone
  typicalNapCount: number; // 0-4, a soft expectation not a cap
  hidden: boolean; // hidden instead of deleted — data is retained
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

export interface Caregiver {
  id: string;
  firstName: string;
  avatar: string | null; // initials or a single emoji
  createdAt: string;
  updatedAt: string;
}

export interface SleepSession {
  id: string;
  childId: string;
  startTime: string; // ISO 8601 UTC with offset
  endTime: string | null; // null while running
  excluded: boolean;
  loggedBy: string | null; // caregiver id, null for imported/unattributed
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null; // soft delete; null = active
}

export interface DayNote {
  id: string;
  childId: string;
  date: string; // YYYY-MM-DD, local calendar day the note is about
  text: string;
  author: string | null; // caregiver id
  createdAt: string;
  updatedAt: string;
}

export type SleepSlot = "nap1" | "nap2" | "nap3" | "nap4" | "bedtime";
