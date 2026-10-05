import {
  ApplicationError,
  incompleteOperationError,
} from "../../../shared/application/application-error";
import { type CollectionJob, type CollectionSchedule, retryDelay } from "../domain/model";
import { advanceComments } from "./bulk-comments";
import type { CollectionAnalytics, CollectionComments, CollectionStore } from "./ports";

const cronIntervalMs = 5 * 60_000;

export class Collect {
  constructor(
    private readonly store: CollectionStore,
    private readonly analytics: CollectionAnalytics,
    private readonly comments: CollectionComments,
    private readonly clock: () => number,
    private readonly operationId: (key: string) => Promise<string>,
    private readonly randomId: () => string,
  ) {}
  async job(id: string) {
    const job = await this.store.job(id);
    if (!job) throw new ApplicationError("NOT_FOUND", "The collection job was not found.");
    return job;
  }
  async start(
    accountId: string,
    id: string,
    origin: CollectionJob["origin"] = "manual",
    automatic = origin === "scheduled",
  ) {
    await this.analytics.account(accountId);
    const previous = await this.store.job(id);
    if (previous) {
      if (
        previous.accountId !== accountId ||
        previous.origin !== origin ||
        previous.automatic !== automatic
      )
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This collection ID was used for another request.",
        );
      return previous;
    }
    if (origin === "comments" && !(await this.comments.enabled(accountId)))
      throw new ApplicationError(
        "INSTAGRAM_PERMISSION_REQUIRED",
        "Grant instagram_business_manage_comments before collecting account comments.",
      );
    const now = this.clock();
    await this.store.create({
      id,
      accountId,
      origin,
      automatic,
      status: "running",
      cursor: null,
      pages: 0,
      collected: 0,
      mediaProcessed: 0,
      attempt: 0,
      failures: 0,
      nextAttemptAt: now,
      startedAt: now,
      completedAt: null,
      lastSuccessAt: null,
      errorCode: null,
    });
    return this.job(id);
  }
  private async supporting(accountId: string, key: string, automatic: boolean) {
    for (const origin of ["audience", "comments"] as const) {
      if (origin === "comments" && !(await this.comments.enabled(accountId))) continue;
      if ((await this.store.latestJob(accountId, origin))?.status === "running") continue;
      await this.start(accountId, await this.operationId(`${key}:${origin}`), origin, automatic);
    }
  }
  async advance(id: string) {
    const now = this.clock();
    const token = this.randomId();
    const job = await this.store.claim(id, token, now);
    if (!job) return this.job(id);
    try {
      const operationId = await this.operationId(`${id}:${job.pages}:${job.attempt}`);
      let cursor: string | null;
      let collected: number;
      let mediaProcessed: number;
      if (job.origin === "comments") {
        const result = await advanceComments(job, operationId, this.store, this.comments);
        cursor = result.cursor;
        collected = result.collected;
        mediaProcessed = result.mediaProcessed;
      } else if (job.origin === "audience") {
        const dimensions = ["age", "gender", "country", "city"] as const;
        const dimension = dimensions[job.pages];
        collected = dimension
          ? await this.analytics.audience(job.accountId, operationId, dimension)
          : 0;
        cursor = job.pages + 1 < dimensions.length ? String(job.pages + 1) : null;
        mediaProcessed = 0;
      } else {
        const result = await this.analytics.page(
          job.accountId,
          operationId,
          job.cursor,
          job.origin === "stories",
        );
        if (result.status !== "completed")
          throw incompleteOperationError(result.status, result.errorCode);
        if (result.nextCursor && result.nextCursor === job.cursor)
          throw new ApplicationError(
            "INSTAGRAM_UNAVAILABLE",
            "Instagram returned a repeated pagination cursor.",
          );
        const stoppedAtKnown =
          job.origin === "scheduled" &&
          (await this.store.sawKnownMedia(operationId, job.startedAt));
        cursor = stoppedAtKnown ? null : result.nextCursor;
        collected = result.mediaCount;
        mediaProcessed = result.mediaCount;
        if (!cursor && job.origin === "manual")
          await this.supporting(job.accountId, `catalogue:${job.id}`, false);
      }
      const completedAt = this.clock();
      const hasMore = cursor !== null;
      await this.store.save(
        {
          ...job,
          pages: job.pages + 1,
          collected: job.collected + collected,
          mediaProcessed: job.mediaProcessed + mediaProcessed,
          cursor,
          status: hasMore ? "running" : "completed",
          completedAt: hasMore ? null : completedAt,
          lastSuccessAt: completedAt,
          failures: 0,
          errorCode: null,
          nextAttemptAt: completedAt,
        },
        token,
        completedAt,
      );
    } catch (error) {
      const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      const waiting = code === "SYNC_IN_PROGRESS";
      const interrupted = code === "SYNC_LEASE_EXPIRED" || code === "COLLECTION_EXPIRED";
      const failures = job.failures + (waiting || interrupted ? 0 : 1);
      await this.store.save(
        {
          ...job,
          attempt: job.attempt + (waiting ? 0 : 1),
          failures,
          status: failures >= 5 ? "failed" : "running",
          errorCode: code,
          nextAttemptAt:
            this.clock() + (waiting || interrupted ? cronIntervalMs : retryDelay(failures)),
        },
        token,
        this.clock(),
      );
    }
    return this.job(id);
  }
  async control(id: string, action: "resume" | "cancel") {
    await this.job(id);
    await this.store.control(id, action === "resume" ? "running" : "cancelled", this.clock());
    return this.job(id);
  }
  async status(accountId: string) {
    await this.analytics.account(accountId);
    return {
      schedule: await this.schedule(accountId),
      jobs: await this.store.jobs(accountId),
      policy: {
        runBudget: 1,
        pageSize: 1,
        storyPageSize: 5,
        commentPageSize: 50,
        cronMinutes: 5,
        ageIntervalsHours: [1, 6, 24, 168],
        maximumConsecutiveFailures: 5,
      },
      note: "A manual catalogue pass queues separate audience and, when permission was granted, account-wide comments jobs. Comments exhaust source pages and replies, including empty intermediate pages; mediaProcessed counts finished publications, collected counts comment observations, not distinct comments. Audience refresh covers all four dimensions in this_month. Scheduled discovery stops at previously observed media; daily insights queue audience and comments refresh. Jobs are bounded and resumable. Scheduling is opt-in; reads never collect data.",
    };
  }
  async schedule(accountId: string): Promise<CollectionSchedule> {
    await this.analytics.account(accountId);
    return (
      (await this.store.schedule(accountId)) ?? {
        accountId,
        enabled: false,
        discoveryMinutes: 360,
        nextDiscoveryAt: this.clock(),
        nextStoriesAt: this.clock(),
        nextInsightsAt: this.clock(),
        updatedAt: this.clock(),
        lastSuccessAt: null,
        errorCode: null,
        failures: 0,
        retryAt: 0,
      }
    );
  }
  async configure(accountId: string, input: { enabled: boolean; discoveryMinutes: number }) {
    const previous = await this.schedule(accountId);
    await this.store.saveSchedule({
      ...previous,
      ...input,
      updatedAt: this.clock(),
      retryAt: 0,
      failures: 0,
    });
    if (!input.enabled)
      for (const job of await this.store.jobs(accountId))
        if (job.automatic && job.status === "running")
          await this.store.control(job.id, "cancelled", this.clock());
    return this.schedule(accountId);
  }
  async tick() {
    const now = this.clock();
    // Alternate preference across Cron slots without global state or another
    // storage table. Either branch consumes the entire one-step run budget.
    const preferSchedule = Math.floor(now / cronIntervalMs) % 2 === 0;
    let schedule = preferSchedule ? await this.store.nextSchedule(now) : null;
    if (!schedule) {
      const id = await this.store.nextJob(now);
      if (id) {
        await this.advance(id);
        return;
      }
      if (!preferSchedule) schedule = await this.store.nextSchedule(now);
    }
    if (!schedule) return;
    let collectingInsights = false;
    try {
      const now = this.clock();
      let lastSuccessAt = schedule.lastSuccessAt;
      if (schedule.nextStoriesAt <= now) {
        const id = await this.operationId(
          `stories:${schedule.accountId}:${schedule.nextStoriesAt}`,
        );
        if ((await this.store.latestJob(schedule.accountId, "stories"))?.status !== "running")
          await this.start(schedule.accountId, id, "stories", true);
        schedule.nextStoriesAt = now + 60 * 60_000;
      } else if (schedule.nextInsightsAt <= now) {
        collectingInsights = true;
        const key = `account-insights:${schedule.accountId}:${schedule.nextInsightsAt}`;
        await this.analytics.activity(schedule.accountId, await this.operationId(key), now);
        await this.supporting(schedule.accountId, key, true);
        lastSuccessAt = this.clock();
        schedule.nextInsightsAt = now + 24 * 60 * 60_000;
      } else if (schedule.nextDiscoveryAt <= now) {
        const id = await this.operationId(
          `discovery:${schedule.accountId}:${schedule.nextDiscoveryAt}`,
        );
        if ((await this.store.latestJob(schedule.accountId, "scheduled"))?.status !== "running")
          await this.start(schedule.accountId, id, "scheduled");
        schedule.nextDiscoveryAt = now + schedule.discoveryMinutes * 60_000;
      } else {
        const mediaId = await this.store.dueMedia(schedule.accountId, now);
        if (mediaId) {
          const result = await this.analytics.refresh(
            mediaId,
            await this.operationId(`refresh:${mediaId}:${Math.floor(now / 900_000)}`),
          );
          if (result.status !== "completed")
            throw incompleteOperationError(result.status, result.errorCode);
          lastSuccessAt = result.completedAt;
        }
      }
      await this.store.finishSchedule(
        {
          ...schedule,
          lastSuccessAt,
          errorCode: null,
          failures: 0,
          retryAt: this.clock() + 15 * 60_000,
        },
        schedule.updatedAt,
      );
    } catch (error) {
      const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      const recoverable =
        code === "SYNC_IN_PROGRESS" ||
        code === "SYNC_LEASE_EXPIRED" ||
        code === "COLLECTION_EXPIRED";
      const retryAt =
        this.clock() + (recoverable ? cronIntervalMs : retryDelay(schedule.failures + 1));
      // A running insight operation keeps its identity until it completes or
      // expires. Only a failed operation gets a new identity for the retry.
      if (collectingInsights && code !== "SYNC_IN_PROGRESS") schedule.nextInsightsAt = retryAt;
      await this.store.finishSchedule(
        {
          ...schedule,
          errorCode: code,
          failures: schedule.failures + (recoverable ? 0 : 1),
          retryAt,
        },
        schedule.updatedAt,
      );
    }
  }
}
