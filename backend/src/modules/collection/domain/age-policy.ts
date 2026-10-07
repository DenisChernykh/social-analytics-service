// Symmetric windows also accept genuine observations collected shortly before
// the target. Scheduling starts at the target and never reconstructs missed ages.
export const ageSnapshotWindows = [
  { targetHours: 1, toleranceHours: 0.5 },
  { targetHours: 6, toleranceHours: 1 },
  { targetHours: 24, toleranceHours: 6 },
  { targetHours: 72, toleranceHours: 6 },
  { targetHours: 168, toleranceHours: 12 },
  { targetHours: 336, toleranceHours: 12 },
  { targetHours: 720, toleranceHours: 24 },
] as const;

export type DueAgeSnapshot = { mediaId: string; targetHours: number; deadline: number };
