export type UsageHeader = {
  state: "absent" | "recognized" | "unknown_schema" | "malformed";
  sample: string | null;
};
// Published keys are percentages. Similar-looking undocumented keys are not aliases.
export function quotaObservation(
  headers: { retryAfter: string | null; appUsage: string | null; businessUsage: string | null },
  now: number,
) {
  const percentages: number[] = [];
  const parse = (header: string | null): UsageHeader => {
    if (header === null) return { state: "absent", sample: null };
    if (header.length > 32_768) return { state: "malformed", sample: null };
    let value: unknown;
    try {
      value = JSON.parse(header);
    } catch {
      return { state: "malformed", sample: null };
    }
    if (!value || typeof value !== "object") return { state: "malformed", sample: null };
    const localPercentages: number[] = [];
    let recognized = false,
      malformed = false;
    const safe: Record<string, number> = {};
    const visit = (item: unknown, depth = 0) => {
      if (depth > 4 || !item || typeof item !== "object") return;
      for (const [key, child] of Object.entries(item)) {
        if (["call_count", "total_time", "total_cputime"].includes(key)) {
          if (typeof child === "number" && Number.isFinite(child) && child >= 0 && child <= 1000) {
            localPercentages.push(child);
            recognized = true;
          } else malformed = true;
        }
        // Only field names and numeric measurements, never arbitrary header strings/IDs.
        if (
          /^[a-z_]{1,50}$/.test(key) &&
          !/(token|secret|password|authorization|code|state|key)/i.test(key) &&
          typeof child === "number" &&
          Number.isFinite(child)
        )
          safe[key] = child;
        else if (typeof child === "object") visit(child, depth + 1);
      }
    };
    visit(value);
    if (!malformed) percentages.push(...localPercentages);
    return {
      state: malformed ? "malformed" : recognized ? "recognized" : "unknown_schema",
      sample: JSON.stringify(safe).slice(0, 2048),
    };
  };
  const app = parse(headers.appUsage),
    business = parse(headers.businessUsage);
  const usagePercent = percentages.length ? Math.max(...percentages) : null;
  const retry = headers.retryAfter?.trim();
  const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : null;
  const retryAt = seconds !== null ? now + seconds * 1000 : retry ? Date.parse(retry) : NaN;
  const retryAfterMs =
    Number.isFinite(retryAt) && retryAt >= now && retryAt <= now + 7 * 86_400_000
      ? retryAt - now
      : 0;
  const adaptiveMs =
    usagePercent !== null && usagePercent >= 100
      ? 30 * 60_000
      : usagePercent !== null && usagePercent >= 90
        ? 5 * 60_000
        : 0;
  return {
    usagePercent,
    retryAfterMs,
    blockedUntil: retryAfterMs || adaptiveMs ? now + Math.max(retryAfterMs, adaptiveMs) : 0,
    usageHeaders: { app, business, receivedAt: now },
  };
}
