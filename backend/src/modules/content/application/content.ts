import { ApplicationError } from "../../../shared/application/application-error";
import type { ContentContext, ContextValues } from "../../../shared/domain/content";
import { classify, distribution, median } from "../domain/analysis";
import { businessResults } from "../domain/business";
import {
  type BusinessRecord,
  divide,
  type Experiment,
  type ExperimentPlan,
  type StorySequence,
} from "../domain/model";
import type { ContentAnalytics, ContentStore } from "./ports";

export type RankInput = {
  accountId: string;
  ageDays: 1 | 7 | 30;
  metric: "reach" | "saves" | "shares" | "comments" | "follows" | "views";
  productType?: string;
  rubric?: string;
  goal?: string;
  format?: string;
  timeZone: string;
};
export class Content {
  constructor(
    private readonly store: ContentStore,
    private readonly analytics: ContentAnalytics,
    private readonly clock: () => number,
  ) {}
  async context(id: string) {
    await this.analytics.media(id);
    return (await this.store.contexts([id])).get(id) ?? null;
  }
  async setContext(
    ids: string[],
    values: ContextValues,
    source: "manual" | "assistant_suggestion",
    replace: boolean,
  ) {
    if (new Set(ids).size !== ids.length)
      throw new ApplicationError("VALIDATION_FAILED", "Select each publication once.");
    for (const id of ids) await this.analytics.media(id);
    const stored = await this.store.contexts(ids);
    const updates = new Map<string, ContentContext>();
    for (const id of ids) {
      const previous = stored.get(id) ?? {
        confirmed: {},
        proposal: {},
        confirmedSource: "manual" as const,
        proposalSource: "assistant_suggestion" as const,
        updatedAt: this.clock(),
      };
      const key = source === "manual" ? "confirmed" : "proposal";
      updates.set(id, {
        ...previous,
        [key]: replace ? values : { ...previous[key], ...values },
        updatedAt: this.clock(),
      });
    }
    await this.store.setContexts(updates);
    return { items: [...updates].map(([mediaId, context]) => ({ mediaId, context })) };
  }
  async importRecords(accountId: string, records: BusinessRecord[]) {
    await this.analytics.account(accountId);
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new ApplicationError("VALIDATION_FAILED", "Duplicate record IDs in import.");
    for (const record of records) {
      const media = await this.analytics.media(record.mediaId);
      if (media.accountId !== accountId)
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "All records must belong to the selected account.",
        );
    }
    await this.store.importRecords(records, this.clock());
    return { imported: records.length, source: "owner_provided", recordedAt: this.clock() };
  }
  async business(id: string) {
    await this.analytics.media(id);
    return businessResults(id, await this.store.businessRecords([id]));
  }
  async rank(input: RankInput) {
    await this.analytics.account(input.accountId);
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    } catch {
      throw new ApplicationError("VALIDATION_FAILED", "Use a valid IANA time zone.");
    }
    const page = await this.analytics.search({ ...input, limit: 100 });
    const observations = await this.analytics.snapshots(
      page.items.map((media) => media.id),
      input.ageDays,
    );
    const entries = page.items.map((media) => {
      const snapshot = observations.get(media.id) ?? null;
      const value = snapshot?.metrics[input.metric].value ?? null;
      const reach = snapshot?.metrics.reach.value ?? null;
      return {
        media,
        snapshot,
        absolute: value,
        rate: divide(value, reach, `${input.metric} / reach`),
        actualAgeDays: snapshot ? (snapshot.observedAt - media.publishedAt) / 86_400_000 : null,
        observationAgeSeconds: snapshot
          ? Math.max(0, this.clock() - snapshot.observedAt) / 1000
          : null,
      };
    });
    const items = entries
      .map((entry) => {
        const peers = entries
          .filter(
            (peer) =>
              peer.media.id !== entry.media.id &&
              peer.media.productType === entry.media.productType &&
              peer.snapshot?.apiVersion === entry.snapshot?.apiVersion &&
              peer.absolute !== null,
          )
          .map((peer) => peer.absolute as number);
        const baseline = median(peers);
        return {
          ...entry,
          baseline,
          sampleSize: peers.length,
          classification: classify(entry.absolute, baseline, peers.length),
        };
      })
      .sort(
        (a, b) => (b.absolute ?? -1) - (a.absolute ?? -1) || a.media.id.localeCompare(b.media.id),
      );
    const groups = new Map<string, number[]>();
    const localHour = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: input.timeZone,
    });
    for (const entry of entries) {
      if (entry.absolute === null) continue;
      const frequency = page.items.filter(
        (other) =>
          other.id !== entry.media.id &&
          other.publishedAt <= entry.media.publishedAt &&
          other.publishedAt > entry.media.publishedAt - 7 * 86_400_000,
      ).length;
      const context = entry.media.context?.confirmed;
      const dimensions: [string, string][] = [
        ["rubric", context?.rubric ?? "unknown"],
        ["format", context?.format ?? "unknown"],
        [
          "duration",
          entry.media.durationSeconds === null
            ? "unknown"
            : entry.media.durationSeconds <= 15
              ? "0-15s"
              : entry.media.durationSeconds <= 30
                ? "15-30s"
                : entry.media.durationSeconds <= 60
                  ? "30-60s"
                  : ">60s",
        ],
        ["localHour", localHour.format(entry.media.publishedAt)],
        ["previous7DayFrequency", String(frequency)],
        ...(context?.topics ?? []).map((topic): [string, string] => ["topic", topic]),
      ];
      for (const [dimension, value] of dimensions) {
        const key = JSON.stringify([
          entry.media.productType,
          entry.snapshot?.apiVersion,
          dimension,
          value,
        ]);
        groups.set(key, [...(groups.get(key) ?? []), entry.absolute]);
      }
    }
    const businessRecords = await this.store.businessRecords(items.map((entry) => entry.media.id));
    const business = items.map((entry) =>
      businessResults(
        entry.media.id,
        businessRecords.filter((record) => record.mediaId === entry.media.id),
      ),
    );
    const efficiency = business
      .flatMap((result) => [
        ...(["leadsPerHour", "salesPerHour"] as const).map((metric) => ({
          mediaId: result.mediaId,
          metric,
          currency: null as string | null,
          ...result[metric],
        })),
        ...result.currencies.flatMap((currency) =>
          (["profitPerHour", "revenuePerCost", "returnOnCost"] as const).map((metric) => ({
            mediaId: result.mediaId,
            metric,
            currency: currency.currency,
            ...currency[metric],
          })),
        ),
      ])
      .sort(
        (a, b) =>
          a.metric.localeCompare(b.metric) ||
          (a.currency ?? "").localeCompare(b.currency ?? "") ||
          Number(b.value !== null) - Number(a.value !== null) ||
          (b.value ?? 0) - (a.value ?? 0) ||
          a.mediaId.localeCompare(b.mediaId),
      );
    return {
      input,
      items,
      business,
      efficiency,
      groups: [...groups].map(([key, values]) => {
        const [productType, apiVersion, dimension, value] = JSON.parse(key) as string[];
        return { productType, apiVersion, dimension, value, ...distribution(values, 5) };
      }),
      coverage: {
        examined: page.items.length,
        observed: observations.size,
        missing: page.items.length - observations.size,
        truncated: !!page.nextCursor,
        toleranceHours: input.ageDays === 1 ? 6 : input.ageDays === 7 ? 12 : 24,
      },
      formulaVersion: "content-v1",
      note: "Real snapshots nearest age 1/7/30 days; no interpolation or reconstructed early history. Rankings are absolute with reach ratios shown. Baselines exclude the target and match product type/API version, minimum 5 peers. Above usual >=1.5x median, below usual <=0.5x. Groups require 5 observations. Publication timing and frequency are associations, not causal advice; frequency uses this capped catalogue. Overlapping topic groups must not be added as an account total.",
    };
  }
  async experiment(id: string) {
    const result = await this.store.experiment(id);
    if (!result) throw new ApplicationError("NOT_FOUND", "The experiment was not found.");
    return result;
  }
  async experiments(accountId: string) {
    await this.analytics.account(accountId);
    return { items: await this.store.experiments(accountId), limit: 100 };
  }
  async createExperiment(accountId: string, id: string, plan: ExperimentPlan) {
    await this.analytics.account(accountId);
    const previous = await this.store.experiment(id);
    if (previous) {
      if (
        previous.accountId !== accountId ||
        JSON.stringify(previous.plan) !== JSON.stringify(plan)
      )
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "The experiment ID already has a different immutable plan.",
        );
      return previous;
    }
    const ids = plan.variants.flatMap((variant) => variant.mediaIds);
    if (
      new Set(ids).size !== ids.length ||
      new Set(plan.variants.map((variant) => variant.name)).size !== plan.variants.length
    )
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Select each media in exactly one uniquely named variant.",
      );
    for (const id of ids) {
      const media = await this.analytics.media(id);
      if (media.accountId !== accountId)
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Experiment publications must belong to this account.",
        );
      if (media.publishedAt < this.clock() && !plan.retrospective)
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Existing publications require retrospective=true. A prospective plan starts with empty variants.",
        );
    }
    const result: Experiment = {
      id,
      accountId,
      createdAt: this.clock(),
      plan,
      assignments: [],
      conclusion: null,
    };
    await this.store.saveExperiment(result);
    return this.experiment(id);
  }
  async conclude(id: string, conclusion: NonNullable<Experiment["conclusion"]>) {
    const experiment = await this.experiment(id);
    await this.store.saveExperiment({
      ...experiment,
      conclusion: { ...conclusion, recordedAt: this.clock(), source: "manual" },
    });
    return this.experiment(id);
  }
  async assign(id: string, assignments: Experiment["assignments"]) {
    const experiment = await this.experiment(id);
    const used = new Set(experiment.plan.variants.flatMap((variant) => variant.mediaIds));
    for (const assignment of assignments) {
      if (
        used.has(assignment.mediaId) ||
        !experiment.plan.variants.some((variant) => variant.name === assignment.variant)
      )
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Choose one existing variant per publication, without duplicates of the original plan.",
        );
      used.add(assignment.mediaId);
      const media = await this.analytics.media(assignment.mediaId);
      if (
        media.accountId !== experiment.accountId ||
        (!experiment.plan.retrospective && media.publishedAt < experiment.createdAt)
      )
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Prospective publications must be published after the plan and belong to the same account.",
        );
    }
    await this.store.saveExperiment({ ...experiment, assignments });
    return this.experiment(id);
  }
  async evaluate(id: string) {
    const experiment = await this.experiment(id);
    const variants = [];
    for (const variant of experiment.plan.variants) {
      const ids = [
        ...variant.mediaIds,
        ...experiment.assignments
          .filter((item) => item.variant === variant.name)
          .map((item) => item.mediaId),
      ];
      const snapshots = await this.analytics.snapshots(ids, experiment.plan.ageDays);
      const publications = [];
      for (const id of ids) {
        const media = await this.analytics.media(id);
        const snapshot = snapshots.get(id) ?? null;
        publications.push({
          media,
          snapshot,
          value: snapshot?.metrics[experiment.plan.metric].value ?? null,
        });
      }
      const values = publications
        .map((item) => item.value)
        .filter((value): value is number => value !== null);
      variants.push({
        name: variant.name,
        publications,
        ...distribution(values, experiment.plan.minimumSample),
      });
    }
    const comparability = new Set(
      variants.flatMap((variant) =>
        variant.publications.map((item) =>
          JSON.stringify([item.media.productType, item.snapshot?.apiVersion]),
        ),
      ),
    );
    return {
      experiment,
      variants,
      decisionReady: comparability.size === 1 && variants.every((variant) => variant.enoughData),
      formulaVersion: "experiment-v1",
      limitations: [
        "Sequential organic publications are not randomized A/B trials. Seasonality, subject matter, product type, other changes and sample selection confound causality.",
        "Distribution and sample size are shown; one successful publication is not proof. Uncertainty is described by the observed range and quartiles, not an invented statistical confidence.",
        "The immutable plan and decision criterion precede assessment; retrospective selection is explicitly flagged. Verdict is supplied by the owner.",
      ],
    };
  }
  async sequence(id: string) {
    const sequence = await this.store.sequence(id);
    if (!sequence) throw new ApplicationError("NOT_FOUND", "The Story sequence was not found.");
    const snapshots = await this.analytics.snapshots(sequence.mediaIds);
    const items = [];
    for (const id of sequence.mediaIds)
      items.push({ media: await this.analytics.media(id), snapshot: snapshots.get(id) ?? null });
    return {
      sequence,
      items,
      coverage: { available: snapshots.size, stories: sequence.mediaIds.length },
      note: "Owner-confirmed sequence in the specified order. Navigation counts actions. Differences in reach do not measure completion by the same unique viewers. Undiscovered expired Stories cannot be backfilled.",
    };
  }
  async setSequence(sequence: StorySequence) {
    await this.analytics.account(sequence.accountId);
    if (new Set(sequence.mediaIds).size !== sequence.mediaIds.length)
      throw new ApplicationError("VALIDATION_FAILED", "Select each Story once.");
    const previous = await this.store.sequence(sequence.id);
    if (previous && previous.accountId !== sequence.accountId)
      throw new ApplicationError("OPERATION_CONFLICT", "The sequence belongs to another account.");
    for (const id of sequence.mediaIds) {
      const media = await this.analytics.media(id);
      if (media.accountId !== sequence.accountId || media.productType !== "STORY")
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Sequence items must be Stories of the selected account.",
        );
    }
    await this.store.saveSequence({ ...sequence, updatedAt: this.clock(), source: "manual" });
    return this.sequence(sequence.id);
  }
}
