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
