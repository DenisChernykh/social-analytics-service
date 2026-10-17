type PeriodIdentity = {
  kind: string;
  from: number;
  to: number;
  timeZone: string;
};

export function refreshActivityQueue<T extends PeriodIdentity>(pending: T[], planned: T[]) {
  // The current period may already have a saved operation under this page's
  // UUID. Keep it first so a replay cannot change that operation's parameters.
  const candidates = pending[0] ? [pending[0], ...planned, ...pending.slice(1)] : planned;
  const seen = new Set<string>();
  return candidates.filter((period) => {
    const key = `${period.timeZone}:${period.kind}:${period.from}:${period.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
