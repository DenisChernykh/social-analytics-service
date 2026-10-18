import {
  ApplicationError,
  retryableOperation,
} from "../../../shared/application/application-error";
import type { Snapshot, SyncRun } from "../domain/model";
import type { AnalyticsRepository, AnalyticsSource } from "./ports";

export class SyncAccount {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly source: AnalyticsSource,
    private readonly clock: () => number,
  ) {}

  requestStats() {
    return this.source.requestStats?.() ?? { attempts: 0 };
  }
  async execute(input: {
    accountId: string;
    operationId: string;
    cursor: string | null;
    pageSize: number;
    kind?: "page" | "media" | "stories";
    mediaId?: string;
    // Internal collection recovery only. Public operation-ID replay remains
    // stable for terminal failures and completed operations.
    retrySourceFailure?: boolean;
  }): Promise<SyncRun> {
    const previous = await this.repository.run(input.operationId);
    if (previous) {
      if (
        previous.accountId !== input.accountId ||
        previous.inputCursor !== input.cursor ||
        previous.pageSize !== input.pageSize ||
        (previous.kind ?? "page") !== (input.kind ?? "page") ||
        (previous.targetMediaId ?? null) !== (input.mediaId ?? null)
      ) {
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This operation ID was already used for different sync parameters.",
        );
      }
      if (
        previous.status === "completed" ||
        (previous.status === "failed" &&
          !retryableOperation(previous.errorCode) &&
          !(input.retrySourceFailure && previous.errorCode === "INSTAGRAM_SOURCE_ERROR"))
      )
        return previous;
      if (previous.status === "running" && this.clock() - previous.startedAt >= 15 * 60_000) {
        await this.repository.fail(previous, "SYNC_LEASE_EXPIRED", this.clock());
      } else if (previous.status === "running") {
        throw new ApplicationError(
          "SYNC_IN_PROGRESS",
          "This sync operation is still running; retrieve its status.",
        );
      }
    }
    const account = await this.repository.account(input.accountId);
    if (!account) throw new ApplicationError("NOT_FOUND", "The account was not found.");
    const now = this.clock();
    const run: SyncRun = {
      id: input.operationId,
      accountId: account.id,
      inputCursor: input.cursor,
      pageSize: input.pageSize,
      status: "running",
      startedAt: now,
      completedAt: null,
      nextCursor: null,
      mediaCount: 0,
      errorCode: null,
      kind: input.kind ?? "page",
      targetMediaId: input.mediaId ?? null,
    };
    if (!(await this.repository.begin(run, now + 15 * 60_000))) {
      throw new ApplicationError(
        "SYNC_IN_PROGRESS",
        "Another sync is running for this account; retry later.",
      );
    }
    try {
      const stored = await this.repository.run(run.id);
      if (
        !stored ||
        stored.accountId !== run.accountId ||
        stored.inputCursor !== run.inputCursor ||
        stored.pageSize !== run.pageSize ||
        (stored.kind ?? "page") !== run.kind ||
        (stored.targetMediaId ?? null) !== run.targetMediaId
      ) {
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This operation ID was already used for different sync parameters.",
        );
      }
      this.source.beginOperation?.(run.id);
      const profile = await this.source.profile(account.id);
      if (profile.userId !== account.externalId)
        throw new ApplicationError(
          "INSTAGRAM_AUTH_EXPIRED",
          "Reconnect the Instagram account; the token belongs to a different account.",
        );
      let page: Awaited<ReturnType<AnalyticsSource["mediaPage"]>>;
      if (input.kind === "media") {
        const existing = input.mediaId ? await this.repository.media(input.mediaId) : null;
        if (!existing || existing.accountId !== account.id)
          throw new ApplicationError("NOT_FOUND", "The media was not found in this account.");
        page = { items: [await this.source.media(account, existing.externalId)], nextCursor: null };
      } else
        page =
          input.kind === "stories"
            ? await this.source.stories(account, input.cursor, input.pageSize)
            : await this.source.mediaPage(account, input.cursor, input.pageSize);
      const items = [];
      for (const item of page.items) {
        const statistics = await this.source.metrics(account.id, item);
        const { collectionError, ...observation } = statistics;
        const snapshot: Snapshot = {
          id: `${run.id}:${item.media.id}`,
          mediaId: item.media.id,
          ...observation,
        };
        items.push({
          media: {
            ...item.media,
            availability: collectionError
              ? {
                  unavailableUntil: this.clock() + collectionError.retryAfterMs,
                  errorCode: collectionError.code,
                }
              : { unavailableUntil: 0, errorCode: null },
          },
          snapshot,
          collectionError,
        });
      }
      // Every publication gets its core pass before optional fields can spend the shared budget.
      // Continuations belong to this operation, retain field receipts, and never read old snapshots.
      if (this.source.additionalMetrics) {
        for (const [index, item] of page.items.entries()) {
          const collected = items[index];
          if (!collected) throw new Error("Missing core observation");
          if (collected.collectionError) continue;
          const statistics = await this.source.additionalMetrics(
            account.id,
            item,
            collected.snapshot,
          );
          collected.snapshot = { ...collected.snapshot, ...statistics };
        }
      }
      const completedAt = this.clock();
      const facts = items.flatMap(({ snapshot }) => [
        ...Object.values(snapshot.metrics),
        ...Object.values(snapshot.storyInsights?.navigation ?? {}),
        ...(snapshot.storyInsights ? [snapshot.storyInsights.replies] : []),
        ...Object.values(snapshot.profileActivity?.actions ?? {}),
      ]);
      const useful = facts.filter((m) => m.value !== null);
      const completed: SyncRun = {
        ...run,
        status: "completed",
        completedAt,
        mediaCount: items.length,
        usefulValues: useful.length,
        lastUsefulAt: useful.length
          ? Math.max(...useful.map((m) => m.provenance?.responseReceivedAt ?? completedAt))
          : null,
        firstUsefulAt: useful.length
          ? Math.min(...useful.map((m) => m.provenance?.responseReceivedAt ?? completedAt))
          : null,
        coverageState:
          useful.length === 0
            ? "empty"
            : facts.some(
                  (m) =>
                    m.value === null &&
                    !["not_supported", "not_requested"].includes(m.reason ?? ""),
                )
              ? "partial"
              : "complete",
        nextCursor: page.nextCursor,
      };
      await this.repository.finish(completed, profile, items, completedAt);
      return completed;
    } catch (error) {
      await this.repository.fail(
        run,
        error instanceof ApplicationError ? error.code : "INTERNAL_ERROR",
        this.clock(),
      );
      throw error;
    }
  }
}
