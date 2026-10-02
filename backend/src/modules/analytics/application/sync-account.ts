import { ApplicationError } from "../../../shared/application/application-error";
import type { Snapshot, SyncRun } from "../domain/model";
import type { AnalyticsRepository, AnalyticsSource } from "./ports";

export class SyncAccount {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly source: AnalyticsSource,
    private readonly clock: () => number,
  ) {}

  async execute(input: {
    accountId: string;
    operationId: string;
    cursor: string | null;
    pageSize: number;
  }): Promise<SyncRun> {
    const previous = await this.repository.run(input.operationId);
    if (previous) {
      if (
        previous.accountId !== input.accountId ||
        previous.inputCursor !== input.cursor ||
        previous.pageSize !== input.pageSize
      ) {
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This operation ID was already used for different sync parameters.",
        );
      }
      if (previous.status !== "running") return previous;
      throw new ApplicationError(
        "SYNC_IN_PROGRESS",
        "This sync operation is still running; retrieve its status.",
      );
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
        stored.pageSize !== run.pageSize
      ) {
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This operation ID was already used for different sync parameters.",
        );
      }
      const profile = await this.source.profile(account.id);
      if (profile.userId !== account.externalId)
        throw new ApplicationError(
          "INSTAGRAM_AUTH_EXPIRED",
          "Reconnect the Instagram account; the token belongs to a different account.",
        );
      const page = await this.source.mediaPage(account, input.cursor, input.pageSize);
      const items = [];
      for (const item of page.items) {
        const statistics = await this.source.metrics(account.id, item);
        const snapshot: Snapshot = {
          id: `${run.id}:${item.media.id}`,
          mediaId: item.media.id,
          ...statistics,
        };
        items.push({ media: item.media, snapshot });
      }
      const completedAt = this.clock();
      const completed: SyncRun = {
        ...run,
        status: "completed",
        completedAt,
        mediaCount: items.length,
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
