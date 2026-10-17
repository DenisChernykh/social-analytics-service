export type WorkCandidate = {
  kind: "schedule" | "job";
  id: string;
  dueAt: number;
  deadline: number;
  cost: number;
  archive: boolean;
};
export function selectWork(candidates: WorkCandidate[], now: number, slot: number) {
  const due = candidates.filter((c) => c.dueAt <= now);
  const urgent = due.filter((c) => c.deadline <= now + 15 * 60_000);
  const reserve = slot % 3 === 2 && !urgent.length ? due.filter((c) => c.archive) : [];
  const ranked = (reserve.length ? reserve : due).sort(
    (a, b) =>
      a.deadline - b.deadline || a.dueAt - b.dueAt || a.cost - b.cost || a.id.localeCompare(b.id),
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
    capacityDeficit: urgent.reduce((n, c) => n + c.cost, 0) > 6,
  };
}
