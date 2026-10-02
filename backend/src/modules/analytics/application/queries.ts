import { ApplicationError } from "../../../shared/application/application-error";
import { calculateGrowth, calculateMetrics, median } from "../domain/calculations";
import { type MetricKey, metricKeys, type ReportDefinition, type Snapshot } from "../domain/model";
import { normalizeSearch, searchWords } from "../domain/search";
import type { AccountHistoryInput, AnalyticsRepository, MediaFilter } from "./ports";

export class AnalyticsQueries {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly clock: () => number,
    private readonly definition: (platform: string, productType: string) => ReportDefinition,
  ) {}
  accounts() {
    return this.repository.accounts();
  }
  observations(ids: string[], ageDays?: number) {
    return ageDays === undefined
      ? this.repository.latest(ids)
      : this.repository.atAge(ids, ageDays);
  }
  async account(id: string) {
    const account = await this.repository.account(id);
    if (!account) throw new ApplicationError("NOT_FOUND", "The account was not found.");
    return account;
  }
  async media(id: string) {
    const media = await this.repository.media(id);
    if (!media) throw new ApplicationError("NOT_FOUND", "The media was not found.");
    return media;
  }
  async mediaSelection(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length > 200)
      throw new ApplicationError("VALIDATION_FAILED", "Select at most 200 publications.");
    const items = await this.repository.selectedMedia(unique);
    if (items.length !== unique.length)
      throw new ApplicationError("NOT_FOUND", "A selected publication was not found.");
    return new Map(items.map((item) => [item.id, item]));
  }
  async search(input: Omit<MediaFilter, "words"> & { query?: string }) {
    if (input.accountId) await this.account(input.accountId);
    const words = searchWords(input.query ?? "");
    if (words.length > 40) {
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Use at most 40 distinct words in the search query.",
      );
    }
    if (input.query && !words.length)
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Use letters or numbers in the media search query.",
      );
    return this.repository.search({ ...input, words });
  }
  async report(id: string) {
    const media = await this.media(id);
    const account = await this.account(media.accountId);
    const definition = this.definition(account.platform, media.productType);
    const [latest, previous] = await this.repository.snapshots(id, 2);
    const missingMetrics = latest
      ? metricKeys.filter((key) => latest.metrics[key].value === null)
      : [...metricKeys];
    return {
      media,
      account,
      source: latest
        ? {
            provider: definition.provider,
            apiVersion: latest.apiVersion,
            observedAt: latest.observedAt,
            ageSeconds: Math.max(0, this.clock() - latest.observedAt) / 1000,
            scope: definition.scope,
            object: definition.object,
            aggregation: definition.aggregation,
          }
        : null,
      metrics: latest?.metrics ?? null,
      storyInsights: latest?.storyInsights ?? null,
      calculated: latest ? calculateMetrics(latest.metrics, media) : null,
      growth: calculateGrowth(previous ?? null, latest ?? null),
      completeness: { snapshotAvailable: !!latest, missingMetrics },
      limitations: definition.limitations,
    };
  }
  async resolve(input: { query: string; accountId?: string }) {
    const words = searchWords(input.query);
    if (!words.length || words.length > 40)
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Use letters or numbers and at most 40 distinct words in the search query.",
      );
    if (input.accountId) await this.account(input.accountId);
    const exact = await this.repository.search({
      accountId: input.accountId,
      words: [],
      exactTitle: normalizeSearch(input.query),
      limit: 20,
    });
    const matches = exact.items.length ? exact : await this.search({ ...input, limit: 20 });
    const candidates = matches.items;
    const status = !candidates.length
      ? ("not_found" as const)
      : candidates.length === 1 && !matches.nextCursor
        ? ("matched" as const)
        : ("ambiguous" as const);
    return {
      status,
      candidates,
      moreMatches: !!matches.nextCursor,
      report: status === "matched" && candidates[0] ? await this.report(candidates[0].id) : null,
    };
  }
  async history(id: string, input: { from?: number; to?: number; cursor?: string; limit: number }) {
    await this.media(id);
    const result = await this.repository.history(
      id,
      input.from,
      input.to,
      input.cursor,
      input.limit,
    );
    const first = result.items.at(-1) ?? null;
    const last = result.items[0] ?? null;
    return {
      ...result,
      growth: calculateGrowth(first === last ? null : first, last),
      intervals: result.items
        .slice(0, -1)
        .map((snapshot, index) => calculateGrowth(result.items[index + 1] ?? null, snapshot)),
      coverage: {
        fromSnapshot: first?.observedAt ?? null,
        toSnapshot: last?.observedAt ?? null,
        truncated: !!result.nextCursor,
      },
    };
  }
  async savedHistory(id: string) {
    await this.media(id);
    const items: Snapshot[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.history(id, undefined, undefined, cursor, 100);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { items, truncated: false };
  }
  private async catalogue(filter: Omit<MediaFilter, "cursor" | "limit">) {
    const items: Awaited<ReturnType<AnalyticsRepository["search"]>>["items"] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.search({ ...filter, cursor, limit: 100 });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { items, nextCursor: null };
  }
  async accountHistory(id: string, input: AccountHistoryInput) {
    await this.account(id);
    const { items, nextCursor, totalObservations, first, last } =
      await this.repository.accountHistory(id, input);
    return {
      items,
      nextCursor,
      followerNetChange:
        totalObservations >= 2 && first?.followersCount != null && last?.followersCount != null
          ? last.followersCount - first.followersCount
          : null,
      coverage: {
        totalObservations,
        fromSnapshot: first?.observedAt ?? null,
        toSnapshot: last?.observedAt ?? null,
        truncated: nextCursor !== null,
      },
      note: "Net follower change between the first and last saved observations in the selected date range, across all pages; not gross follows or unfollows. Coverage describes saved history, not the account's lifetime before collection began.",
    };
  }
  async updateMedia(id: string, input: { title?: string | null; durationSeconds?: number | null }) {
    await this.media(id);
    await this.repository.updateMedia(id, input, this.clock());
    return this.media(id);
  }
  async run(id: string) {
    const run = await this.repository.run(id);
    if (!run) throw new ApplicationError("NOT_FOUND", "The sync operation was not found.");
    if (run.status === "running" && this.clock() - run.startedAt >= 15 * 60_000) {
      await this.repository.fail(run, "SYNC_LEASE_EXPIRED", this.clock());
      return {
        ...run,
        status: "failed" as const,
        completedAt: this.clock(),
        errorCode: "SYNC_LEASE_EXPIRED",
      };
    }
    return run;
  }
  async summary(
    accountId: string,
    filter: {
      from?: number;
      to?: number;
      productType?: string;
      rubric?: string;
      goal?: string;
      format?: string;
    },
  ) {
    const account = await this.account(accountId);
    const page = await this.catalogue({ ...filter, accountId, words: [] });
    const snapshots = await this.repository.latest(page.items.map((media) => media.id));
    const entries = page.items.map((media) => ({
      media,
      snapshot: snapshots.get(media.id) ?? null,
    }));
    const total = (key: MetricKey) => {
      const values = entries
        .map((entry) => entry.snapshot?.metrics[key].value ?? null)
        .filter((v): v is number => v !== null);
      return {
        value:
          values.length === entries.length && entries.length > 0 && !page.nextCursor
            ? values.reduce((sum, v) => sum + v, 0)
            : null,
        knownSum: values.reduce((sum, v) => sum + v, 0),
        available: values.length,
        mediaCount: entries.length,
      };
    };
    const latestTimes = entries
      .map((entry) => entry.snapshot?.observedAt)
      .filter((v): v is number => v !== undefined);
    return {
      account,
      cohort: {
        publishedFrom: filter.from ?? null,
        publishedTo: filter.to ?? null,
        productType: filter.productType ?? null,
        mediaCount: entries.length,
        truncated: !!page.nextCursor,
      },
      totals: {
        views: total("views"),
        likes: total("likes"),
        comments: total("comments"),
        saves: total("saves"),
        shares: total("shares"),
      },
      snapshotRange: {
        oldest: latestTimes.length ? Math.min(...latestTimes) : null,
        newest: latestTimes.length ? Math.max(...latestTimes) : null,
      },
      note: "Cumulative lifetime metrics for media published in this cohort; not activity during the selected dates. Reach is not summed across media because viewers overlap.",
    };
  }
  async benchmark(id: string) {
    const media = await this.media(id);
    const target = (await this.repository.snapshots(id, 1))[0] ?? null;
    const page = await this.catalogue({
      accountId: media.accountId,
      productType: media.productType,
      words: [],
    });
    const peers: Snapshot[] = [];
    const peerSnapshots = await this.repository.latest(page.items.map((peer) => peer.id));
    for (const peer of page.items) {
      if (peer.id === id) continue;
      const snapshot = peerSnapshots.get(peer.id);
      if (snapshot) peers.push(snapshot);
    }
    return {
      mediaId: id,
      cohort: {
        accountId: media.accountId,
        productType: media.productType,
        examined: page.items.length,
        snapshots: peers.length,
        truncated: !!page.nextCursor,
      },
      comparisons: Object.fromEntries(
        (["views", "reach", "saves", "shares"] as const).map((key) => {
          const values = peers
            .map((peer) => peer.metrics[key].value)
            .filter((value): value is number => value !== null);
          const baseline = median(values);
          const value = target?.metrics[key].value ?? null;
          return [
            key,
            {
              value,
              median: baseline,
              sampleSize: values.length,
              ratioToMedian:
                value !== null && baseline !== null && baseline > 0 ? value / baseline : null,
            },
          ];
        }),
      ),
      note: "Lifetime comparison with all saved publications of the same product type, across catalogue pages. Publication ages and observation times can differ; this is not a causal or age-normalized ranking.",
    };
  }
}
