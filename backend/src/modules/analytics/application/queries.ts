import { ApplicationError } from "../../../shared/application/application-error";
import { calculateGrowth, calculateMetrics, median } from "../domain/calculations";
import { type MetricKey, metricKeys, type Snapshot } from "../domain/model";
import { normalizeSearch, searchWords } from "../domain/search";
import type { AnalyticsRepository, MediaFilter } from "./ports";

export class AnalyticsQueries {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly clock: () => number,
  ) {}
  accounts() {
    return this.repository.accounts();
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
    const [latest, previous] = await this.repository.snapshots(id, 2);
    const missingMetrics = latest
      ? metricKeys.filter((key) => latest.metrics[key].value === null)
      : [...metricKeys];
    return {
      media,
      account,
      source: latest
        ? {
            provider: "instagram_api" as const,
            apiVersion: latest.apiVersion,
            observedAt: latest.observedAt,
            ageSeconds: Math.max(0, this.clock() - latest.observedAt) / 1000,
            scope: "organic_instagram_lifetime" as const,
          }
        : null,
      metrics: latest?.metrics ?? null,
      calculated: latest ? calculateMetrics(latest.metrics, media) : null,
      growth: calculateGrowth(previous ?? null, latest ?? null),
      completeness: { snapshotAvailable: !!latest, missingMetrics },
      limitations: [
        "Instagram insights may lag behind by up to 48 hours.",
        "Metrics cover organic Instagram activity; paid and cross-platform totals are separate.",
        "Watch-time ratio is not a completion rate and can exceed 100%.",
        "Historical growth starts with the snapshots collected by this service.",
      ],
    };
  }
  async resolve(input: { query: string; accountId?: string }) {
    const matches = await this.search({ ...input, limit: 20 });
    const exact = matches.items.filter(
      (item) => item.title && normalizeSearch(item.title) === normalizeSearch(input.query),
    );
    const candidates = exact.length === 1 && !matches.nextCursor ? exact : matches.items;
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
      coverage: {
        fromSnapshot: first?.observedAt ?? null,
        toSnapshot: last?.observedAt ?? null,
        truncated: !!result.nextCursor,
      },
    };
  }
  async accountHistory(id: string, limit: number) {
    await this.account(id);
    const items = await this.repository.accountHistory(id, limit);
    const first = items.at(-1)?.followersCount ?? null;
    const last = items[0]?.followersCount ?? null;
    return {
      items,
      followerNetChange: items.length >= 2 && first !== null && last !== null ? last - first : null,
      note: "Net follower change between the returned observations; not gross follows or unfollows.",
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
    return run;
  }
  async summary(accountId: string, filter: { from?: number; to?: number; productType?: string }) {
    const account = await this.account(accountId);
    const page = await this.repository.search({ ...filter, accountId, words: [], limit: 1000 });
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
    const page = await this.repository.search({
      accountId: media.accountId,
      productType: media.productType,
      words: [],
      limit: 100,
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
      note: "Lifetime comparison with up to 100 recent publications of the same product type. Publication ages and observation times can differ; this is not a causal or age-normalized ranking.",
    };
  }
}
