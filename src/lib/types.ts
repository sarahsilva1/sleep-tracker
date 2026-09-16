export interface Child {
  id: string;
  name: string;
  dateOfBirth: string; // YYYY-MM-DD
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
  deleted?: boolean;
}

export interface SleepSession {
  id: string;
  childId: string;
  startTime: string; // ISO 8601 UTC with offset
  endTime: string | null; // null while running
  excluded: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface DayNote {
  id: string;
  childId: string;
  date: string; // YYYY-MM-DD, local calendar day the note is about
  text: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export type SleepSlot = "nap1" | "nap2" | "nap3" | "bedtime";

export interface SweetSpotOverride {
  childId: string;
  slot: SleepSlot;
  wakeWindowMinutes: number;
}
