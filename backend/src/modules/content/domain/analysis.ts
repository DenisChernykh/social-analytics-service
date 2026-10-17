export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
export function distribution(values: number[], minimum: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    sampleSize: sorted.length,
    median: median(sorted),
    minimum: sorted[0] ?? null,
    maximum: sorted.at(-1) ?? null,
    q25: sorted.length ? (sorted[Math.floor((sorted.length - 1) * 0.25)] ?? null) : null,
    q75: sorted.length ? (sorted[Math.floor((sorted.length - 1) * 0.75)] ?? null) : null,
    enoughData: sorted.length >= minimum,
  };
}
export function classify(value: number | null, baseline: number | null, sampleSize: number) {
  const ratio = value !== null && baseline !== null && baseline > 0 ? value / baseline : null;
  return {
    ratio,
    label:
      sampleSize < 5 || ratio === null
        ? "insufficient_data"
        : ratio >= 1.5
          ? "above_usual"
          : ratio <= 0.5
            ? "below_usual"
            : "typical",
    minimumSample: 5,
    highThreshold: 1.5,
    lowThreshold: 0.5,
  };
}

export type RankingMode = "absolute" | "per_100_reach" | "per_100_views";
export function rankingValue(
  numerator: number | null,
  denominator: number | null,
  mode: RankingMode,
  compatible = true,
) {
  const reason =
    numerator === null || (mode !== "absolute" && denominator === null)
      ? "missing_inputs"
      : !compatible
        ? "incompatible_measurements"
        : mode !== "absolute" && (denominator ?? 0) <= 0
          ? "zero_denominator"
          : null;
  return {
    value:
      reason === null
        ? mode === "absolute"
          ? numerator
          : (100 * (numerator as number)) / (denominator as number)
        : null,
    reason,
    formula:
      mode === "absolute"
        ? "native value"
        : `100 * numerator / ${mode === "per_100_reach" ? "reach" : "views"}`,
  };
}
export function pairedAggregate(pairs: { numerator: number; denominator: number }[]) {
  const numerator = pairs.reduce((n, p) => n + p.numerator, 0),
    denominator = pairs.reduce((n, p) => n + p.denominator, 0);
  return {
    n: pairs.length,
    medianIndividualPer100: median(pairs.map((p) => (100 * p.numerator) / p.denominator)),
    ratioOfSumsPer100: denominator > 0 ? (100 * numerator) / denominator : null,
    numeratorSum: numerator,
    denominatorSum: denominator,
    denominatorMeaning: "sum of per-media denominators, not unique account reach",
  };
}
