import { ApplicationError } from "../../../shared/application/application-error";
import {
  compareCategories,
  compareValues,
  type InsightCollection,
  type InsightInput,
} from "../domain/model";
import type { AccountInsightSource, InsightSelection, InsightStore } from "./ports";

export class AccountInsights {
  constructor(
    private readonly store: InsightStore,
    private readonly source: AccountInsightSource,
    private readonly clock: () => number,
    private readonly apiVersion: string,
  ) {}
  async collection(id: string) {
    const collection = await this.store.collection(id);
    if (!collection)
      throw new ApplicationError("NOT_FOUND", "The insight collection was not found.");
    if (collection.status === "running" && this.clock() - collection.requestedAt >= 15 * 60_000)
      return { ...collection, status: "failed" as const, errorCode: "COLLECTION_EXPIRED" };
    return collection;
  }
  async collect(accountId: string, id: string, input: InsightInput): Promise<InsightCollection> {
    await this.source.account(accountId);
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    } catch {
      throw new ApplicationError("VALIDATION_FAILED", "Use a valid IANA time zone.");
    }
    if (input.kind === "activity") {
      if (
        input.from === undefined ||
        input.to === undefined ||
        input.from >= input.to ||
        input.to - input.from > 31 * 86_400_000 ||
        input.to > this.clock() ||
        input.from < this.clock() - 90 * 86_400_000 ||
        input.from % 1000 ||
        input.to % 1000
      )
        throw new ApplicationError(
          "VALIDATION_FAILED",
          "Select whole-second boundaries, at most 31 days, within the last 90 days and not in the future. Periods are [from,to). Save older collected history locally.",
        );
    }
    const previous = await this.store.collection(id);
    if (previous) {
      if (
        previous.accountId !== accountId ||
        JSON.stringify(previous.input) !== JSON.stringify(input)
      )
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This operation ID was used for other insight parameters.",
        );
      return this.collection(id);
    }
    const collection: InsightCollection = {
      id,
      accountId,
      input,
      status: "running",
      requestedAt: this.clock(),
      observedAt: null,
      apiVersion: this.apiVersion,
      provider: "instagram_api",
      scope:
        input.kind === "activity" ? "instagram_account_period" : "instagram_audience_timeframe",
      aggregation: input.kind === "activity" ? "period" : "timeframe",
      object: input.kind === "activity" ? "account" : "audience",
      values: [],
      errorCode: null,
    };
    if (!(await this.store.reserve(collection))) return this.collect(accountId, id, input);
    try {
      collection.values = await this.source.read(accountId, input);
      collection.observedAt = this.clock();
      collection.status = "completed";
    } catch (error) {
      collection.status = "failed";
      collection.errorCode = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      await this.store.finish(collection);
      throw error;
    }
    await this.store.finish(collection);
    return collection;
  }
  async history(
    accountId: string,
    kind: "activity" | "demographics",
    limit: number,
    cursor?: string,
    selection: InsightSelection = {},
  ) {
    await this.source.account(accountId);
    if (cursor) {
      const match = /^(\d+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        cursor,
      );
      const observedAt = Number(match?.[1]);
      if (!match || !Number.isSafeInteger(observedAt))
        throw new ApplicationError("VALIDATION_FAILED", "The insight history cursor is invalid.");
      selection = { ...selection, cursor: { observedAt, id: match[2] as string } };
    }
    const observations = await this.store.observations(accountId, kind, limit, selection);
    const last = observations[limit - 1];
    return {
      items: observations.slice(0, limit),
      truncated: observations.length > limit,
      nextCursor:
        observations.length > limit && last && last.observedAt !== null
          ? `${last.observedAt}:${last.id}`
          : null,
      limits:
        kind === "activity"
          ? [
              "Account metrics may be available for up to 90 days; availability varies by field.",
              "Each observation retains the requested interval and collection time. Latest total_value for an identical interval replaces the earlier reading in comparisons, never by summing.",
              "Reach is not summed across publications, days or breakdown categories.",
            ]
          : [
              "Timeframe is a Meta window, not arbitrary since/until dates.",
              "At least 100 followers or engaged accounts can be required. Meta may return only top categories; unknown categories are not zeros.",
              "Percentage denominators are the returned total_value only; category sums are not the population.",
            ],
    };
  }
  async activity(
    accountId: string,
    input: {
      from: number;
      to: number;
      timeZone: string;
      compareFrom?: number;
      compareTo?: number;
      metricType: "total_value" | "time_series";
      breakdown?: string;
    },
  ) {
    await this.source.account(accountId);
    const select = (from: number, to: number) =>
      this.store.observations(accountId, "activity", 1, {
        period: {
          from,
          to,
          timeZone: input.timeZone,
          metricType: input.metricType,
          breakdown: input.breakdown,
        },
      });
    const [currentItems, previousItems] = await Promise.all([
      select(input.from, input.to),
      input.compareFrom !== undefined && input.compareTo !== undefined
        ? select(input.compareFrom, input.compareTo)
        : Promise.resolve([]),
    ]);
    const current = currentItems[0] ?? null;
    const previous = previousItems[0] ?? null;
    const comparable =
      !!current &&
      !!previous &&
      current.apiVersion === previous.apiVersion &&
      input.to - input.from === (input.compareTo ?? 0) - (input.compareFrom ?? 0);
    return {
      accountId,
      requestedPeriod: {
        from: input.from,
        to: input.to,
        timeZone: input.timeZone,
        semantics: "[from,to)",
      },
      current,
      previous,
      comparable,
      comparisons:
        current?.values.map((item) => ({
          metric: item.metric,
          ...compareValues(
            item.metricType === "total_value" ? item.value : null,
            comparable
              ? (previous?.values.find((other) => other.metric === item.metric)?.value ?? null)
              : null,
          ),
        })) ?? [],
      categoryComparisons: compareCategories(
        current?.values ?? [],
        previous?.values ?? [],
        comparable,
      ),
      coverage: {
        currentAvailable: current !== null,
        previousAvailable: previous !== null,
        truncated: false,
        requestedWindowComplete: input.to <= this.clock() - 48 * 3_600_000,
        observedAt: current?.observedAt ?? null,
      },
      note: "Account activity in the exact collected period, including older publications. No lifetime cohort sums or summed daily unique reach are substituted. Periods ending within 48 hours can be incomplete. Missing exact period collections are explicit gaps; collect them explicitly.",
    };
  }
  async audience(
    accountId: string,
    timeframe: string,
    breakdown: string,
    limit: number,
    cursor?: string,
  ) {
    const history = await this.history(accountId, "demographics", limit, cursor, {
      timeframe,
      breakdown,
    });
    const items = history.items;
    return {
      items,
      truncated: history.truncated,
      nextCursor: history.nextCursor,
      percentages: items.map((item) => ({
        collectionId: item.id,
        audiences: item.values.map((value) => ({
          metric: value.metric,
          denominator: value.value,
          categories: value.breakdowns.flatMap((group) =>
            group.results.map((entry) => ({
              ...entry,
              percent:
                entry.value !== null && value.value !== null && value.value > 0
                  ? (entry.value / value.value) * 100
                  : null,
            })),
          ),
        })),
      })),
      comparison:
        items.length >= 2 && items[0]?.apiVersion === items[1]?.apiVersion
          ? {
              current: items[0]?.id,
              previous: items[1]?.id,
              note: "Comparable definitions and Meta timeframe; rolling windows can overlap. Different audiences are not merged.",
            }
          : null,
      limitations: history.limits,
    };
  }
}
