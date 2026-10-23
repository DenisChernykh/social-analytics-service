export const commentPolicy = {
  outerPageSize: 50,
  replyPageSize: 50,
  recentHours: 72,
  recentRefreshHours: 1,
  monthRefreshHours: 6,
  archiveRefreshHours: 168,
  fullReconciliationDays: 30,
  // Maximum omitted parents queued from one bounded outer page, not a pass cap.
  omittedProbeLimit: 50,
} as const;

export function commentRefreshDelay(publishedAt: number, now: number): number {
  const ageHours = Math.max(0, now - publishedAt) / 3_600_000;
  return (
    (ageHours < commentPolicy.recentHours
      ? commentPolicy.recentRefreshHours
      : ageHours < 720
        ? commentPolicy.monthRefreshHours
        : commentPolicy.archiveRefreshHours) * 3_600_000
  );
}

export type CommentCheckpoint = {
  mediaId: string;
  publishedAt: number;
  complete: boolean;
  omittedBranches: number;
  eventGeneration: number;
  unavailableUntil?: number;
  errorCode?: string | null;
};
