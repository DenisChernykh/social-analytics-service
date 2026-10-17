export type ActivityPeriod = {
  kind: "day" | "week" | "month";
  from: number;
  to: number;
  timeZone: string;
};
export type PeriodObservation = { from: number; to: number; observedAt: number };
export type ActivityPeriodPlan = ReturnType<typeof activityPeriodPlan>;
const day = 86_400_000;

// Calendar boundaries use the requested zone, including 23/25-hour days.
// The caller supplies time and observations; the domain never reads a clock.
export function activityPeriodPlan(
  now: number,
  timeZone: string,
  observations: PeriodObservation[],
) {
  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = (at: number) =>
    Object.fromEntries(
      formatter
        .formatToParts(at)
        .filter((part) => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
        .map((part) => [part.type, Number(part.value)]),
    );
  const current = parts(now);
  const calendarToday = Date.UTC(
    current.year as number,
    (current.month as number) - 1,
    current.day,
  );
  const boundaries = new Map<number, number>();
  const midnight = (calendar: number) => {
    const cached = boundaries.get(calendar);
    if (cached !== undefined) return cached;
    let at = calendar;
    for (let attempt = 0; attempt < 4; attempt++) {
      const p = parts(at),
        represented = Date.UTC(
          p.year as number,
          (p.month as number) - 1,
          p.day,
          p.hour,
          p.minute,
          p.second,
        );
      if (represented === calendar) {
        boundaries.set(calendar, at);
        return at;
      }
      at += calendar - represented;
    }
    // A midnight can disappear during an offset transition. Find the first
    // actual instant of that local date rather than inventing midnight.
    let low = calendar - 36 * 3_600_000,
      high = calendar + 36 * 3_600_000;
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2000) * 1000,
        p = parts(middle);
      if (Date.UTC(p.year as number, (p.month as number) - 1, p.day) >= calendar) high = middle;
      else low = middle;
    }
    boundaries.set(calendar, high);
    return high;
  };
  const periods: ActivityPeriod[] = [];
  const uncollectableIntervals: Array<ActivityPeriod & { reason: "exceeds_interval_limit" }> = [];
  const add = (kind: ActivityPeriod["kind"], start: number, end: number) => {
    const from = midnight(start),
      to = midnight(end);
    if (from >= now - 90 * day && to <= now && from < to) {
      if (to - from > 31 * day)
        uncollectableIntervals.push({ kind, from, to, timeZone, reason: "exceeds_interval_limit" });
      else periods.push({ kind, from, to, timeZone });
    }
  };
  for (let index = 1; index <= 90; index++)
    add("day", calendarToday - index * day, calendarToday - (index - 1) * day);
  const monday = calendarToday - ((new Date(calendarToday).getUTCDay() + 6) % 7) * day;
  for (let index = 1; index <= 13; index++)
    add("week", monday - index * 7 * day, monday - (index - 1) * 7 * day);
  for (let index = 1; index <= 3; index++)
    add(
      "month",
      Date.UTC(current.year as number, (current.month as number) - 1 - index, 1),
      Date.UTC(current.year as number, (current.month as number) - index, 1),
    );
  const latest = new Map<string, number>();
  for (const observation of observations) {
    const key = `${observation.from}:${observation.to}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, observation.observedAt));
  }
  const pending = periods.filter(
    (period) =>
      (latest.get(`${period.from}:${period.to}`) ?? 0) < Math.min(now, period.to + 48 * 3_600_000),
  );
  const recentBoundary = midnight(calendarToday - 3 * day);
  const priority = (period: ActivityPeriod) =>
    period.kind === "day" && period.to >= recentBoundary ? 0 : period.to >= recentBoundary ? 1 : 2;
  pending.sort(
    (a, b) =>
      a.from + 90 * day - (b.from + 90 * day) ||
      priority(a) - priority(b) ||
      (priority(a) < 2 ? b.to - a.to : a.from - b.from) ||
      a.kind.localeCompare(b.kind),
  );
  const count = (kind: ActivityPeriod["kind"]) =>
    periods.filter((period) => period.kind === kind).length;
  return {
    periods: pending,
    coverage: {
      timeZone,
      providerWindowDays: 90,
      expectedIntervals: periods.length,
      observedIntervals: periods.filter((period) => latest.has(`${period.from}:${period.to}`))
        .length,
      missingIntervals: periods.filter((period) => !latest.has(`${period.from}:${period.to}`))
        .length,
      recheckIntervals: pending.filter((period) => latest.has(`${period.from}:${period.to}`))
        .length,
      dailyIntervals: count("day"),
      weeklyIntervals: count("week"),
      monthlyIntervals: count("month"),
      uncollectableIntervals,
      earliestDayFrom: periods.filter((period) => period.kind === "day").at(-1)?.from ?? null,
      latestDayTo: periods.find((period) => period.kind === "day")?.to ?? null,
    },
  };
}
