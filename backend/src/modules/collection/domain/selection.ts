export type WorkCandidate = {
  kind: "schedule" | "job";
  id: string;
  dueAt: number;
  deadline: number;
  archive: boolean;
  lastAttemptAt?: number | null;
};
export function selectWork(candidates: WorkCandidate[], now: number, sequence: number) {
  const due = candidates.filter((c) => c.dueAt <= now);
  const urgent = due.filter((c) => c.deadline <= now + 15 * 60_000);
  const reserve =
    sequence % 3 === 2 && urgent.every((c) => c.archive) ? due.filter((c) => c.archive) : [];
  const ranked = (reserve.length ? reserve : due).sort(
    (a, b) =>
      (reserve.length ? (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0) : 0) ||
      a.deadline - b.deadline ||
      a.dueAt - b.dueAt ||
      a.id.localeCompare(b.id),
  );
  return {
    selected: ranked[0] ?? null,
    reason: reserve.length
      ? "archive_reserve"
      : urgent.length
        ? "deadline_at_risk"
        : "earliest_deadline",
    dueActions: due.length,
    atRisk: urgent.length,
  };
}
