import type { CollectionJob } from "./model";

export function jobState(job: CollectionJob, now: number) {
  if (job.status === "failed" && job.errorCode === "INSTAGRAM_PAGINATION_STALLED")
    return { effectiveState: "incomplete", waitingReason: "pagination_stalled" };
  if (job.status !== "running")
    return {
      effectiveState:
        job.status === "completed" && (job.skippedMedia > 0 || job.skippedPeriods > 0)
          ? "incomplete"
          : job.status,
      waitingReason: null,
    };
  if (job.leaseExpiresAt && job.leaseExpiresAt <= now)
    return { effectiveState: "lease_expired", waitingReason: "lease_expired" };
  if (job.leaseExpiresAt && job.leaseExpiresAt > now)
    return { effectiveState: "running", waitingReason: null };
  if (job.nextAttemptAt > now) return { effectiveState: "waiting", waitingReason: "backoff" };
  return { effectiveState: "ready", waitingReason: null };
}
