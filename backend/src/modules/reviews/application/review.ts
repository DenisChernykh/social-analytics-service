import type { Account, Media, Snapshot } from "../../analytics/public-contracts";
import { growthIntervals, resurgence } from "../domain/signals";
export type ReviewInput = {
  from: number;
  to: number;
  compareFrom?: number;
  compareTo?: number;
  timeZone: string;
  ageDays: 1 | 7 | 30;
};
export interface ReviewEvidence {
  account(id: string): Promise<Account>;
  activity(id: string, input: ReviewInput): Promise<unknown>;
  summary(id: string, input: ReviewInput): Promise<unknown>;
  ranking(
    id: string,
    input: ReviewInput,
  ): Promise<{
    items: {
      media: Media;
      absolute: number | null;
      baseline: number | null;
      sampleSize: number;
      classification: { label: string };
      snapshot: Snapshot | null;
    }[];
    coverage: unknown;
  }>;
  history(id: string): Promise<{ items: Snapshot[]; truncated: boolean }>;
}
export class Review {
  constructor(
    private readonly evidence: ReviewEvidence,
    private readonly clock: () => number,
  ) {}
  async execute(accountId: string, input: ReviewInput) {
    const account = await this.evidence.account(accountId);
    const [activity, lifetime, ranking] = await Promise.all([
      this.evidence.activity(accountId, input),
      this.evidence.summary(accountId, input),
      this.evidence.ranking(accountId, input),
    ]);
    const growth = [];
    const signals = [];
    const actions = [];
    for (const entry of ranking.items.slice(0, 30)) {
      const history = await this.evidence.history(entry.media.id);
      const intervals = growthIntervals(
        history.items.map((snapshot) => ({
          id: snapshot.id,
          observedAt: snapshot.observedAt,
          views: snapshot.metrics.views.value,
        })),
      );
      const selected = intervals.filter((item) => item.to >= input.from && item.to < input.to);
      const burst = resurgence(
        entry.media.publishedAt,
        intervals.filter((item) => item.to < input.to),
      );
      growth.push({
        mediaId: entry.media.id,
        permalink: entry.media.permalink,
        intervals: selected,
        truncated: history.truncated,
        resurgence: burst,
      });
      const unusual =
        entry.classification.label === "above_usual" ||
        entry.classification.label === "below_usual";
      if (
        unusual &&
        entry.snapshot &&
        entry.media.publishedAt >= input.from &&
        entry.media.publishedAt < input.to
      ) {
        signals.push({
          kind: entry.classification.label,
          mediaId: entry.media.id,
          permalink: entry.media.permalink,
          metric: "reach",
          value: entry.absolute,
          baseline: entry.baseline,
          sampleSize: entry.sampleSize,
          observedAt: entry.snapshot.observedAt,
          source: "instagram_api",
          formula: "reach at matched age / median reach of same-product/API peers",
          cause: "hypothesis_required",
        });
        actions.push({
          mediaId: entry.media.id,
          action: `Test another ${entry.media.context?.confirmed.rubric ?? entry.media.productType} publication with the same topic and a different hook, keeping the format and target age comparable.`,
          targetMetric: "reach",
          ageDays: input.ageDays,
          decisionRule:
            "At least five observations per variant; compare medians and quartiles at the selected age.",
          evidence: "matched-age reach signal",
        });
      }
      if (burst.detected && burst.last && burst.last.to >= input.from) {
        signals.push({
          kind: "old_media_resurgence",
          mediaId: entry.media.id,
          permalink: entry.media.permalink,
          metric: "views_per_hour",
          value: burst.last.perHour,
          baseline: burst.baselinePerHour,
          sampleSize: 3,
          observedAt: burst.last.to,
          source: "instagram_api",
          formula:
            "latest observed view velocity >=3x median of prior three intervals, gain>=100, publication age>=30d",
          cause: "hypothesis_required",
        });
        actions.push({
          mediaId: entry.media.id,
          action:
            "Collect another snapshot after one day and check whether the observed view velocity persists before planning a follow-up on this topic.",
          targetMetric: "views_per_hour",
          ageDays: input.ageDays,
          decisionRule:
            "Use actual elapsed hours; require nondecreasing counters and a collection interval under seven days.",
          evidence: "observed resurgence",
        });
      }
    }
    return {
      account,
      period: {
        from: input.from,
        to: input.to,
        compareFrom: input.compareFrom ?? null,
        compareTo: input.compareTo ?? null,
        timeZone: input.timeZone,
        semantics: "[from,to)",
      },
      generatedAt: this.clock(),
      formulaVersion: "review-v1",
      accountActivity: activity,
      publicationLifetime: lifetime,
      snapshotChanges: growth,
      signals,
      nextActions: actions,
      coverage: {
        ranking: ranking.coverage,
        growthExamined: Math.min(ranking.items.length, 30),
        growthTruncated: ranking.items.length > 30,
        periodIncomplete: input.to > this.clock() - 48 * 3_600_000,
      },
      limitations: [
        "Account period insights, publication lifetime metrics and changes between observed snapshots are distinct evidence sections.",
        "Missing collection, API rejection and decreasing counters never become a decline-in-interest signal. Matched-age signals require five peers, 1.5x/0.5x median thresholds.",
        "Causes and proposed actions are hypotheses, not causal claims or promises of performance. No automated publication, spending, LLM service or message delivery.",
        "Review is computed on request, not stored. Explicit periods and formulaVersion make its calculations identifiable; later readings may change as source data are updated.",
      ],
    };
  }
}
