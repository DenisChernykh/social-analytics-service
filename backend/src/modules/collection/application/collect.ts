import { ApplicationError } from "../../../shared/application/application-error";
import { type CollectionJob, type CollectionSchedule, retryDelay } from "../domain/model";
import { advanceComments } from "./bulk-comments";
import type { CollectionAnalytics, CollectionComments, CollectionStore } from "./ports";

const maximumJobAdvances = 12;

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
    let job = await this.job(id);
    const now = this.clock();
    const token = this.randomId();
    if (!(await this.store.claim(id, token, now))) return this.job(id);
    job = await this.job(id);
    if (job.status !== "running") return job;
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
          throw new ApplicationError(
            "INSTAGRAM_UNAVAILABLE",
            "The page failed; resume collection after retry backoff.",
          );
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
      const failures = job.failures + (waiting ? 0 : 1);
      await this.store.save(
        {
          ...job,
          attempt: job.attempt + (waiting ? 0 : 1),
          failures,
          status: failures >= 5 ? "failed" : "running",
          errorCode: code,
          nextAttemptAt: this.clock() + retryDelay(failures),
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
        runBudget: maximumJobAdvances + 1,
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
    const skipped = new Set<string>();
    let advances = 0;
    let advancedOtherJob = false;
    while (advances < maximumJobAdvances) {
      const active = (await this.store.jobs()).find(
        (job) =>
          job.status === "running" &&
          job.nextAttemptAt <= this.clock() &&
          !skipped.has(job.id) &&
          (job.origin === "comments" || !advancedOtherJob),
      );
      if (!active) break;
      const result = await this.advance(active.id);
      advances++;
      // Other pages may gather several metrics; retain their one-page budget.
      if (active.origin !== "comments") advancedOtherJob = true;
      if (result.pages === active.pages) skipped.add(active.id);
    }
    const schedules = await this.store.schedules();
    const schedule = schedules.find((item) => item.failures < 5 && item.retryAt <= this.clock());
    if (!schedule) return;
    try {
      const now = this.clock();
      let lastSuccessAt = schedule.lastSuccessAt;
      if (schedule.nextStoriesAt <= now) {
        const id = await this.operationId(
          `stories:${schedule.accountId}:${schedule.nextStoriesAt}`,
        );
        const job = await this.start(schedule.accountId, id, "stories", true);
        if (advances === 0) {
          const result = await this.advance(job.id);
          lastSuccessAt = result.lastSuccessAt ?? lastSuccessAt;
          if (result.errorCode)
            throw new ApplicationError(
              "INSTAGRAM_UNAVAILABLE",
              "Scheduled Stories collection failed; inspect its job.",
            );
        }
        schedule.nextStoriesAt = now + 60 * 60_000;
      } else if (schedule.nextInsightsAt <= now) {
        const key = `account-insights:${schedule.accountId}:${schedule.nextInsightsAt}`;
        await this.analytics.activity(schedule.accountId, await this.operationId(key), now);
        await this.supporting(schedule.accountId, key, true);
        lastSuccessAt = this.clock();
        schedule.nextInsightsAt = now + 24 * 60 * 60_000;
      } else if (schedule.nextDiscoveryAt <= now) {
        const id = await this.operationId(
          `discovery:${schedule.accountId}:${schedule.nextDiscoveryAt}`,
        );
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
            throw new ApplicationError(
              "INSTAGRAM_UNAVAILABLE",
              "Scheduled refresh failed; inspect its sync operation.",
            );
          lastSuccessAt = result.completedAt;
        }
      }
      const current = await this.store.schedule(schedule.accountId);
      if (current?.enabled && current.updatedAt === schedule.updatedAt)
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
      const current = await this.store.schedule(schedule.accountId);
      if (current?.enabled && current.updatedAt === schedule.updatedAt)
        await this.store.finishSchedule(
          {
            ...schedule,
            errorCode: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR",
            failures: schedule.failures + 1,
            retryAt: this.clock() + retryDelay(schedule.failures + 1),
          },
          schedule.updatedAt,
        );
    }
  }
}
