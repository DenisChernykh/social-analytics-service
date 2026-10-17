export type PolicyInterval = {
  effectiveFrom: number;
  effectiveTo: number | null;
  enabled: boolean;
  version: string;
  availability?: "configured" | "unavailable" | null;
  grantExpiresAt?: number | null;
};
export function ageCoverage(
  objects: { id: string; publishedAt: number; productType: string; connectedAt: number }[],
  observations: { mediaId: string; observedAt: number; usable: boolean }[],
  policies: PolicyInterval[],
  now: number,
  targetHours: number,
  toleranceHours: number,
) {
  const excludedByReason: Record<string, number> = {},
    obligationExclusions: Record<string, number> = {};
  const add = (map: Record<string, number>, reason: string) => {
    map[reason] = (map[reason] ?? 0) + 1;
  };
  let observed = 0,
    missingEligible = 0,
    open = 0,
    closed = 0,
    expected = 0,
    capturedObligations = 0,
    missed = 0,
    unknown = 0;
  for (const m of objects) {
    const target = m.publishedAt + targetHours * 3_600_000,
      start = target - toleranceHours * 3_600_000,
      end = target + toleranceHours * 3_600_000;
    if (m.productType === "STORY") {
      add(excludedByReason, "inapplicable_story");
      add(obligationExclusions, "inapplicable_story");
      continue;
    }
    if (now < start) {
      add(excludedByReason, "too_early");
      add(obligationExclusions, "too_early");
      continue;
    }
    const captured = observations.some(
      (o) =>
        o.mediaId === m.id &&
        o.usable &&
        o.observedAt >= start &&
        o.observedAt <= end &&
        o.observedAt <= now,
    );
    if (now <= end) open++;
    else closed++;
    if (captured) observed++;
    else if (now < target) add(excludedByReason, "target_not_reached");
    else if (m.connectedAt > end) add(excludedByReason, "connected_after_window");
    else missingEligible++;
    const policy = policies.find(
      (p) =>
        p.enabled &&
        p.availability !== "unavailable" &&
        Math.max(p.effectiveFrom, m.connectedAt, target) <=
          Math.min(p.effectiveTo ?? now, end, p.grantExpiresAt ?? Infinity) - 300_000,
    );
    if (policy) {
      expected++;
      if (captured) capturedObligations++;
      else if (now > end) missed++;
    } else if (m.connectedAt > end) add(obligationExclusions, "connected_after_window");
    else if (
      policies.some(
        (p) =>
          p.availability === "unavailable" &&
          p.effectiveFrom <= start &&
          (p.effectiveTo ?? now) >= Math.min(now, end),
      )
    )
      add(obligationExclusions, "access_unavailable");
    else if (
      policies.some(
        (p) =>
          !p.enabled && p.effectiveFrom <= start && (p.effectiveTo ?? now) >= Math.min(now, end),
      )
    )
      add(obligationExclusions, "policy_not_active");
    else {
      unknown++;
      add(obligationExclusions, "policy_history_unknown_or_insufficient_opportunity");
    }
  }
  return {
    targetHours,
    toleranceHours,
    analysisCoverage: {
      examined: objects.length,
      observed,
      missingEligible,
      excludedByReason,
      open,
      closed,
    },
    collectionObligations: {
      expected,
      captured: capturedObligations,
      missed,
      open: Math.max(0, expected - capturedObligations - missed),
      policyHistoryUnknown: unknown,
      excludedByReason: obligationExclusions,
      minimumOpportunityMs: 300_000,
      note: "Only recorded active policy intervals with at least one Cron slot establish a conditional obligation. Configured grant expiry and known access denial constrain opportunity; revocation and historical source availability are not fully measured. Unknown legacy policy/access history is not a missed SLA. Analysis observations are independent.",
    },
  };
}
