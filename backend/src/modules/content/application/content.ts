import { ApplicationError } from "../../../shared/application/application-error";
import type { ContentContext, ContextValues } from "../../../shared/domain/content";
import { compatibleMeasurements } from "../../../shared/domain/measurement";
import {
  classify,
  distribution,
  median,
  pairedAggregate,
  type RankingMode,
  rankingValue,
} from "../domain/analysis";
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
  rankingMode?: RankingMode;
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
    await this.analytics.selection(ids);
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
    const selected = await this.analytics.selection(records.map((record) => record.mediaId));
    for (const record of records) {
      const media = selected.get(record.mediaId);
      if (media?.accountId !== accountId)
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
    const account = (await this.analytics.account(input.accountId)) as { connectedAt?: number };
    const rankingMode = input.rankingMode ?? "absolute";
    input = { ...input, rankingMode };
    const denominatorMetric = rankingMode === "per_100_views" ? "views" : "reach";
    const toleranceHours = input.ageDays === 1 ? 6 : input.ageDays === 7 ? 12 : 24;
    const now = this.clock();
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    } catch {
      throw new ApplicationError("VALIDATION_FAILED", "Use a valid IANA time zone.");
    }
    const page = await this.analytics.search({ ...input, limit: 100 });
    let cursor = page.nextCursor;
    while (cursor) {
      const next = await this.analytics.search({ ...input, limit: 100, cursor });
      page.items.push(...next.items);
      cursor = next.nextCursor;
    }
    page.nextCursor = null;
    const observations = await this.analytics.snapshots(
      page.items.map((media) => media.id),
      input.ageDays,
    );
    const validObservations = await this.analytics.snapshots(
      page.items.map((m) => m.id),
      input.ageDays,
      {
        metric: input.metric,
        ...(rankingMode !== "absolute"
          ? { denominator: denominatorMetric as "reach" | "views" }
          : {}),
      },
    );
    const entries = page.items.map((media) => {
      const snapshot = validObservations.get(media.id) ?? observations.get(media.id) ?? null;
      const numerator = snapshot?.metrics[input.metric] ?? null,
        denominator = snapshot?.metrics[denominatorMetric] ?? null;
      const pairCompatible =
        !!numerator && !!denominator && compatibleMeasurements(numerator, denominator);
      const compatible = rankingMode === "absolute" || pairCompatible;
      const score = rankingValue(
        numerator?.value ?? null,
        denominator?.value ?? null,
        rankingMode,
        compatible,
      );
      const start = media.publishedAt + (input.ageDays * 24 - toleranceHours) * 3_600_000,
        end = media.publishedAt + (input.ageDays * 24 + toleranceHours) * 3_600_000;
      const windowState = now < start ? "too_early" : now <= end ? "open" : "closed";
      const context = media.context?.confirmed;
      const comparabilityKey = JSON.stringify([
        media.productType,
        media.mediaType,
        snapshot?.apiVersion ?? null,
        numerator?.provenance?.login ?? null,
        numerator?.provenance?.requestedApiVersion ?? null,
        numerator?.provenance?.actualApiVersion ?? null,
        numerator?.sourceField ?? null,
        numerator?.provenance?.definitionVersion ?? null,
        numerator?.provenance?.surface ?? "unknown",
        numerator?.provenance?.distribution ?? "unknown",
        numerator?.unit ?? null,
        rankingMode !== "absolute" ? denominator?.sourceField : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.login ?? null) : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.requestedApiVersion ?? null) : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.actualApiVersion ?? null) : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.definitionVersion ?? null) : null,
        rankingMode !== "absolute" ? denominator?.unit : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.surface ?? "unknown") : null,
        rankingMode !== "absolute" ? (denominator?.provenance?.distribution ?? "unknown") : null,
        context?.rubric ?? "unknown",
        context?.topics ?? [],
        context?.sponsored ?? "unknown",
        context?.paidDistribution ?? "unknown",
        context?.brandPartnership ?? "unknown",
        context?.coauthor ?? "unknown",
      ]);
      const exclusion =
        score.value !== null
          ? null
          : !snapshot
            ? windowState === "too_early"
              ? "too_early"
              : (account.connectedAt ?? Infinity) > end
                ? "connected_after_window"
                : "missing_observation"
            : score.reason;
      return {
        media,
        snapshot,
        pairCompatible,
        absolute: numerator?.value ?? null,
        rate: {
          ...divide(
            numerator?.value ?? null,
            denominator?.value ?? null,
            `${input.metric} / ${denominatorMetric}`,
          ),
          ...(!pairCompatible && numerator?.value != null && denominator?.value != null
            ? { value: null, reason: "incompatible_measurements" }
            : {}),
        },
        rankingValue: score.value,
        ranking: {
          ...score,
          mode: rankingMode,
          denominatorMetric: rankingMode === "absolute" ? null : denominatorMetric,
          numerator: numerator?.value ?? null,
          denominator: denominator?.value ?? null,
          unit: rankingMode === "absolute" ? "count" : "actions_per_100",
        },
        windowState,
        exclusion,
        comparabilityKey,
        actualAgeDays: snapshot ? (snapshot.observedAt - media.publishedAt) / 86_400_000 : null,
        observationAgeSeconds: snapshot ? Math.max(0, now - snapshot.observedAt) / 1000 : null,
      };
    });
    const items = entries
      .map((entry) => {
        const peers = entries
          .filter(
            (p) =>
              p.media.id !== entry.media.id &&
              p.comparabilityKey === entry.comparabilityKey &&
              p.rankingValue !== null,
          )
          .map((p) => p.rankingValue as number);
        const baseline = median(peers);
        return {
          ...entry,
          baseline,
          sampleSize: peers.length,
          classification: classify(entry.rankingValue, baseline, peers.length),
          comparisonCriteria: {
            productType: entry.media.productType,
            mediaType: entry.media.mediaType,
            definitionVersion:
              entry.snapshot?.metrics[input.metric].provenance?.definitionVersion ?? null,
            surface: entry.snapshot?.metrics[input.metric].provenance?.surface ?? "unknown",
            ageDays: input.ageDays,
            toleranceHours,
            promotion: {
              paidDistribution: entry.media.context?.confirmed.paidDistribution ?? null,
              brandPartnership: entry.media.context?.confirmed.brandPartnership ?? null,
              coauthor: entry.media.context?.confirmed.coauthor ?? null,
              legacySponsored: entry.media.context?.confirmed.sponsored ?? null,
            },
          },
          sampleWarning:
            peers.length < 2
              ? "Extremely small descriptive sample; no causal or significance claim."
              : peers.length < 5
                ? "Small sample; five peers is a product heuristic, not statistical significance."
                : "Descriptive observational comparison, not a causal effect or significance test.",
        };
      })
      .sort(
        (a, b) =>
          Number(b.rankingValue !== null) - Number(a.rankingValue !== null) ||
          (b.rankingValue ?? 0) - (a.rankingValue ?? 0) ||
          a.media.id.localeCompare(b.media.id),
      );
    const grouped = new Map<string, typeof entries>();
    const localHour = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: input.timeZone,
    });
    for (const entry of entries) {
      const context = entry.media.context?.confirmed;
      const dimensions: [string, string][] = [
        ["rubric", context?.rubric ?? "unknown"],
        ["format", context?.format ?? "unknown"],
        ["localHour", localHour.format(entry.media.publishedAt)],
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
        [
          "previous7DayFrequency",
          String(
            page.items.filter(
              (o) =>
                o.id !== entry.media.id &&
                o.publishedAt <= entry.media.publishedAt &&
                o.publishedAt > entry.media.publishedAt - 7 * 86_400_000,
            ).length,
          ),
        ],
        ...(context?.topics ?? []).map((t): [string, string] => ["topic", t]),
      ];
      for (const [dimension, value] of dimensions) {
        const key = JSON.stringify([entry.comparabilityKey, dimension, value]);
        grouped.set(key, [...(grouped.get(key) ?? []), entry]);
      }
    }
    const groups = [...grouped].map(([key, values]) => {
      const [, dimension, value] = JSON.parse(key) as string[];
      const example = values[0];
      const pairs = values
        .filter(
          (v) =>
            v.pairCompatible &&
            v.absolute !== null &&
            v.ranking.denominator !== null &&
            (v.ranking.denominator as number) > 0,
        )
        .map((v) => ({
          numerator: v.absolute as number,
          denominator: v.ranking.denominator as number,
        }));
      return {
        productType: example?.media.productType,
        mediaType: example?.media.mediaType,
        apiVersion: example?.snapshot?.apiVersion,
        dimension,
        value,
        ...distribution(
          values.flatMap((v) => (v.rankingValue === null ? [] : [v.rankingValue])),
          5,
        ),
        examined: values.length,
        mediaIds: values.map((v) => v.media.id),
        pairedMediaIds: values
          .filter(
            (v) =>
              v.pairCompatible &&
              v.absolute !== null &&
              v.ranking.denominator !== null &&
              v.ranking.denominator > 0,
          )
          .map((v) => v.media.id),
        excludedByReason: values.reduce<Record<string, number>>((r, v) => {
          if (v.exclusion) r[v.exclusion] = (r[v.exclusion] ?? 0) + 1;
          return r;
        }, {}),
        paired: { ...pairedAggregate(pairs), excludedPairs: values.length - pairs.length },
        rankingMode,
        note: "Median of individual scores and ratio of sums use named statistics; timing is observational at every n. Unknown promotion remains unknown.",
      };
    });
    const excludedByReason: Record<string, number> = {};
    for (const entry of entries)
      if (entry.exclusion)
        excludedByReason[entry.exclusion] = (excludedByReason[entry.exclusion] ?? 0) + 1;
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
      groups,
      coverage: {
        examined: page.items.length,
        observed: entries.filter((e) => e.rankingValue !== null).length,
        missing: entries.filter(
          (e) =>
            e.exclusion === "missing_observation" ||
            e.exclusion === "missing_inputs" ||
            e.exclusion === "zero_denominator" ||
            e.exclusion === "incompatible_measurements",
        ).length,
        analysisCoverage: {
          examined: entries.length,
          usable: entries.filter((e) => e.rankingValue !== null).length,
          missingEligible: entries.filter(
            (e) => e.exclusion === "missing_observation" || e.exclusion === "missing_inputs",
          ).length,
          excludedByReason,
          metric: input.metric,
          rankingMode,
          open: entries.filter((e) => e.windowState === "open").length,
          closed: entries.filter((e) => e.windowState === "closed").length,
        },
        collectionObligations: {
          state: "not_evaluated",
          note: "This endpoint describes analysis coverage. Recorded policy obligations are available in get_collection_status; missing analysis observations are not missed jobs.",
        },
        truncated: !!page.nextCursor,
        toleranceHours: input.ageDays === 1 ? 6 : input.ageDays === 7 ? 12 : 24,
      },
      formulaVersion: "content-v2",
      note: "Genuine nearest usable age snapshots with deterministic time/id ties; tolerances 1d±6h,7d±12h,30d±24h. No interpolation. Selected rankingMode controls sorting, baselines and groups. Peers match product, mediaType, API, definition/scope, confirmed rubric/topics/promotion; legacy definitions remain unknown. Ratios use one observation, request times within 60s; lastKnownGood is never substituted. Unknown paid coverage is disclosed and is not inferred as organic; only an explicitly contradictory paid scope excludes a pair. Actions per 100 reach/views are not percentages of unique people and are not capped at 100. Five peers is a product heuristic, not statistical significance. Timing/topics are observational; small n retains descriptive results. Groups overlap and are not account totals.",
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
    const selected = await this.analytics.selection(ids);
    for (const id of ids) {
      const media = selected.get(id);
      if (media?.accountId !== accountId)
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
    const selected = await this.analytics.selection(
      assignments.map((assignment) => assignment.mediaId),
    );
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
      const media = selected.get(assignment.mediaId);
      if (
        media?.accountId !== experiment.accountId ||
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
    const selected = await this.analytics.selection([
      ...experiment.plan.variants.flatMap((variant) => variant.mediaIds),
      ...experiment.assignments.map((item) => item.mediaId),
    ]);
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
        const media = selected.get(id);
        if (!media) throw new ApplicationError("NOT_FOUND", "The publication was not found.");
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
    const selected = await this.analytics.selection(sequence.mediaIds);
    const items = [];
    for (const id of sequence.mediaIds) {
      const media = selected.get(id);
      if (!media) throw new ApplicationError("NOT_FOUND", "The publication was not found.");
      items.push({ media, snapshot: snapshots.get(id) ?? null });
    }
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
    const selected = await this.analytics.selection(sequence.mediaIds);
    for (const id of sequence.mediaIds) {
      const media = selected.get(id);
      if (media?.accountId !== sequence.accountId || media.productType !== "STORY")
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Sequence items must be Stories of the selected account.",
        );
    }
    await this.store.saveSequence({ ...sequence, updatedAt: this.clock(), source: "manual" });
    return this.sequence(sequence.id);
  }
}
