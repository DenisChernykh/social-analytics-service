import {
  ApplicationError,
  incompleteOperationError,
} from "../../../shared/application/application-error";
import { objectFailureDelay } from "../../../shared/domain/source-failure";
import type { ActivityPeriod } from "../../account-insights";
import { refreshActivityQueue } from "../domain/activity-policy";
import { ageSnapshotWindows, storyFinalSnapshotWindowMs } from "../domain/age-policy";
import { type CommentCheckpoint, commentPolicy } from "../domain/comment-policy";
import { jobState } from "../domain/job-state";
import {
  type CataloguePosition,
  type CollectionJob,
  type CollectionSchedule,
  type CommentEvent,
  type CommentPosition,
  retryDelay,
  collectionRetryIntervalMs as retryIntervalMs,
} from "../domain/model";
import { selectWork, type WorkCandidate } from "../domain/selection";
import { advanceComments } from "./bulk-comments";
import { collectionExecution } from "./execution-policy";
import type { CollectionAnalytics, CollectionComments, CollectionStore } from "./ports";

export class Collect {
  private selectionSequence = 0;
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
    return { ...job, ...jobState(job, this.clock()) };
  }
  async start(
    accountId: string,
    id: string,
    origin: CollectionJob["origin"] = "manual",
    automatic = origin === "scheduled",
    target?: CataloguePosition,
    periods?: ActivityPeriod[],
  ) {
    await this.analytics.account(accountId);
    const previous = await this.store.job(id);
    if (previous) {
      if (
        previous.accountId !== accountId ||
        previous.origin !== origin ||
        previous.automatic !== automatic ||
        (previous.targetMediaId ?? null) !== (target?.id ?? null)
      )
        throw new ApplicationError(
          "OPERATION_CONFLICT",
          "This collection ID was used for another request.",
        );
      return previous;
    }
    if (
      (origin === "comments" || origin === "comments_refresh") &&
      !(await this.comments.enabled(accountId))
    )
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
      cursor: target
        ? JSON.stringify({
            version: 2,
            afterMedia: null,
            current: target,
            commentCursor: null,
            parents: [],
            replyCursor: null,
          })
        : periods
          ? JSON.stringify(periods)
          : null,
      targetMediaId: target?.id ?? null,
      pages: 0,
      collected: 0,
      mediaProcessed: 0,
      skippedMedia: 0,
      skippedPeriods: 0,
      attempt: 0,
      failures: 0,
      nextAttemptAt: now,
      startedAt: now,
      latencyOrigin: "recorded_from_creation",
      completedAt: null,
      lastSuccessAt: null,
      errorCode: null,
    });
    return this.job(id);
  }
  private async supporting(accountId: string, key: string, automatic: boolean) {
    for (const origin of ["audience", "comments"] as const) {
      if (origin === "comments" && !(await this.comments.enabled(accountId))) continue;
      const latest = await this.store.latestJob(accountId, origin);
      if (latest?.status === "running") continue;
      if (
        origin === "comments" &&
        automatic &&
        latest?.status === "completed" &&
        latest.completedAt != null &&
        this.clock() - latest.completedAt < commentPolicy.fullReconciliationDays * 86_400_000
      )
        continue;
      await this.start(accountId, await this.operationId(`${key}:${origin}`), origin, automatic);
    }
  }
  async advance(id: string) {
    const now = this.clock();
    const token = this.randomId();
    const job = await this.store.claim(id, token, now);
    if (!job) return this.job(id);
    const requestStats = () =>
      ["comments", "comments_refresh"].includes(job.origin)
        ? (this.comments.requestStats?.().attempts ?? 0)
        : (this.analytics.requestStats?.().attempts ?? 0);
    const beforeAttempts = requestStats();
    let checkpoint: CommentCheckpoint | undefined;
    try {
      const operationId = await this.operationId(`${id}:${job.pages}`);
      let cursor: string | null;
      let collected: number;
      let usefulValues: number | undefined;
      let firstUsefulAt: number | undefined;
      let lastUsefulAt: number | undefined;
      let mediaProcessed: number;
      let skippedMedia = 0;
      let skippedPeriods = 0;
      if (job.origin === "comments" || job.origin === "comments_refresh") {
        const result = await advanceComments(
          job,
          operationId,
          this.store,
          this.comments,
          token,
          now,
        );
        cursor = result.cursor;
        collected = result.collected;
        mediaProcessed = result.mediaProcessed;
        checkpoint = result.checkpoint;
        skippedMedia = result.skippedMedia;
      } else if (job.origin === "activity") {
        const periods = JSON.parse(job.cursor ?? "[]") as ActivityPeriod[];
        const period = periods[0];
        collected = 0;
        if (period) {
          if (period.from < now - 90 * 86_400_000) skippedPeriods = 1;
          else {
            const portion = await this.analytics.activity(job.accountId, operationId, period);
            usefulValues = typeof portion === "number" ? portion : portion.collected;
            if (typeof portion !== "number") {
              firstUsefulAt = portion.firstUsefulAt ?? undefined;
              lastUsefulAt = portion.lastUsefulAt ?? undefined;
            }
            collected = 1;
          }
        }
        cursor = periods.length > 1 ? JSON.stringify(periods.slice(1)) : null;
        mediaProcessed = 0;
      } else if (job.origin === "audience") {
        const dimensions = ["age", "gender", "country", "city"] as const;
        const dimension = dimensions[job.pages];
        const portion = dimension
          ? await this.analytics.audience(job.accountId, operationId, dimension)
          : 0;
        collected = typeof portion === "number" ? portion : portion.collected;
        if (typeof portion !== "number") {
          firstUsefulAt = portion.firstUsefulAt ?? undefined;
          lastUsefulAt = portion.lastUsefulAt ?? undefined;
        }
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
            "INSTAGRAM_PAGINATION_STALLED",
            "Instagram returned a repeated pagination cursor.",
          );
        const stoppedAtKnown =
          job.origin === "scheduled" &&
          (await this.store.sawKnownMedia(operationId, job.startedAt));
        cursor = stoppedAtKnown ? null : result.nextCursor;
        usefulValues = result.usefulValues ?? 0;
        firstUsefulAt = result.firstUsefulAt ?? undefined;
        lastUsefulAt = result.lastUsefulAt ?? undefined;
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
          firstUsefulObservationAt:
            job.latencyOrigin === "recorded_from_creation" && (usefulValues ?? collected) > 0
              ? (job.firstUsefulObservationAt ?? firstUsefulAt ?? completedAt)
              : (job.firstUsefulObservationAt ?? null),
          lastUsefulObservationAt:
            (usefulValues ?? collected) > 0
              ? (lastUsefulAt ?? firstUsefulAt ?? completedAt)
              : (job.lastUsefulObservationAt ?? null),
          httpAttemptsSinceAt: job.httpAttemptsSinceAt ?? now,
          httpAttempts: (job.httpAttempts ?? 0) + Math.max(0, requestStats() - beforeAttempts),
          lastStepDurationMs: completedAt - now,
          lastStepHttpAttempts: Math.max(0, requestStats() - beforeAttempts),
          pages: job.pages + 1,
          collected: job.collected + collected,
          mediaProcessed: job.mediaProcessed + mediaProcessed,
          skippedMedia: job.skippedMedia + skippedMedia,
          skippedPeriods: job.skippedPeriods + skippedPeriods,
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
        checkpoint,
      );
    } catch (error) {
      const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      const waiting = [
        "SYNC_IN_PROGRESS",
        "REQUEST_BUDGET_EXHAUSTED",
        "INSTAGRAM_RATE_LIMITED",
        "INSTAGRAM_AUTH_EXPIRED",
        "INSTAGRAM_PERMISSION_REQUIRED",
      ].includes(code);
      const interrupted =
        code === "SYNC_LEASE_EXPIRED" ||
        code === "COLLECTION_EXPIRED" ||
        [
          "REQUEST_BUDGET_EXHAUSTED",
          "INSTAGRAM_RATE_LIMITED",
          "INSTAGRAM_AUTH_EXPIRED",
          "INSTAGRAM_PERMISSION_REQUIRED",
        ].includes(code);
      const failures = job.failures + (waiting || interrupted ? 0 : 1);
      if ((job.origin === "comments" || job.origin === "comments_refresh") && job.cursor) {
        const position = JSON.parse(job.cursor) as CommentPosition;
        if (position.current)
          checkpoint = {
            mediaId: position.current.id,
            publishedAt: position.current.publishedAt,
            complete: false,
            omittedBranches: position.omittedBranches ?? 0,
            eventGeneration: position.eventGeneration ?? 0,
          };
      }
      await this.store.save(
        {
          ...job,
          httpAttemptsSinceAt: job.httpAttemptsSinceAt ?? now,
          httpAttempts: (job.httpAttempts ?? 0) + Math.max(0, requestStats() - beforeAttempts),
          lastStepDurationMs: this.clock() - now,
          lastStepHttpAttempts: Math.max(0, requestStats() - beforeAttempts),
          attempt: job.attempt + (code === "SYNC_IN_PROGRESS" ? 0 : 1),
          failures,
          status:
            (code === "INSTAGRAM_PAGINATION_STALLED" &&
              job.origin !== "comments" &&
              job.origin !== "comments_refresh") ||
            failures >= 5
              ? "failed"
              : "running",
          errorCode: code,
          nextAttemptAt:
            this.clock() +
            Math.max(
              code === "INSTAGRAM_RATE_LIMITED"
                ? 15 * 60_000
                : waiting || interrupted
                  ? retryIntervalMs
                  : retryDelay(failures),
              error instanceof ApplicationError ? (error.retryAfterMs ?? 0) : 0,
            ),
        },
        token,
        this.clock(),
        checkpoint,
      );
    }
    return this.job(id);
  }
  async control(id: string, action: "resume" | "cancel") {
    await this.job(id);
    await this.store.control(id, action === "resume" ? "running" : "cancelled", this.clock());
    return this.job(id);
  }
  async status(accountId: string, input: { limit: number; cursor?: string } = { limit: 20 }) {
    await this.analytics.account(accountId);
    const schedule = await this.schedule(accountId);
    const plan = await this.analytics.activityPlan(accountId, schedule.timeZone, this.clock());
    const now = this.clock();
    const page = await this.store.jobPage(accountId, input, now);
    const diagnostics = await this.store.diagnostics(accountId, now);
    return {
      schedule,
      jobs: page.items.map((job) => ({
        ...job,
        ...jobState(job, now),
        queueWaitMs:
          job.firstAttemptAt === null || job.firstAttemptAt === undefined
            ? null
            : job.firstAttemptAt - job.startedAt,
        continuationWaitMs:
          job.status === "running" && job.lastAttemptAt != null
            ? Math.max(0, now - job.lastAttemptAt)
            : null,
      })),
      jobsPage: {
        ...page,
        items: undefined,
        calculatedAt: now,
        semantics:
          "Stable createdAt/id keyset, createdAt<=cutoff; states/aggregates are live at calculatedAt; no mutable status filter.",
      },
      diagnostics,
      freshness: page.aggregates.map((a) => ({ ...a, lastCheck: a.lastSuccess })),
      dataFreshness: await this.store.dataFreshness(accountId),
      mediaRefresh: await this.store.mediaRefreshStatus(accountId, now),
      capacity: {
        dueJobs: page.aggregates.reduce((n, a) => n + a.due, 0),
        atRiskFreshJobs: page.aggregates.reduce((n, a) => n + a.atRiskFresh, 0),
        scope:
          "All jobs within cutoff; freshDue is a lower bound of steps for this account, excluding undiscovered objects and other accounts.",
        maximumHttpAttemptsPerTick: collectionExecution.maximumHttpAttempts,
        tickWorkMs: collectionExecution.workBudgetMs,
        persistenceReserveMs: collectionExecution.persistenceReserveMs,
        pressureIndicator: page.aggregates.some((a) => a.freshDue > 0),
        overload: "not_measured" as const,
        assumptions:
          "Durable Object alarms continue ready portions without a fixed Cron slot quota. Throughput depends on source latency, access, leases and quota; capacity is not measured by counting due jobs.",
      },
      comments: await this.store.commentStatus(accountId, this.clock()),
      coverage: {
        ...(await this.store.coverage(accountId, this.clock())),
        activity: plan.coverage,
      },
      api: await this.analytics.apiStatus(accountId),
      policy: {
        runBudget: 1,
        maximumHttpAttempts: collectionExecution.maximumHttpAttempts,
        workBudgetMs: collectionExecution.workBudgetMs,
        persistenceReserveMs: collectionExecution.persistenceReserveMs,
        version: "collection-v2",
        pageSize: collectionExecution.pageSize,
        storyPageSize: collectionExecution.pageSize,
        commentPageSize: commentPolicy.outerPageSize,
        commentPolicy,
        cronMinutes: 5,
        ageIntervalsHours: ageSnapshotWindows.map((window) => window.targetHours),
        ageSnapshotWindows: [...ageSnapshotWindows],
        maximumConsecutiveFailures: 5,
      },
      note: "Calendar days, Monday-based weeks and calendar months use the schedule timeZone and exact [from,to) intervals within the service's 90-day guard; field-specific source expiry is not universally confirmed. Fresh periods are reread after source delay. observedIntervals counts saved collections, including null metrics; inspect each value and reason. Intervals exceeding the 31-day guard are explicit limitations, never sums of unique reach. Analysis uses genuine age observations even from pre-connection publications. Collection obligations require recorded policy intervals and opportunity; historical policy is unknown. Discovery measurement excludes inferred timestamps; denominator zero is not measured. The catalogue is fully reconciled every 30 days. Omitted replies are probed at most twice per publication; unverified branches remain explicit. Object-unavailable responses retain a neutral reason and a 24-hour pause; auth and rate errors retain retryable work. completed means the end of the attempted pass and can include skipped objects; it does not guarantee equality with Meta comments_count. HTTP attempts, responses, pre-response failures, latency and backoff are distinct from job steps. Unknown usage schema does not establish free quota. Internal 90-day and 31-day guards are implementation policy, not universal Meta guarantees. OAuth requests are excluded from this counter. Webhook activity requires subscription and verified delivery. Scheduling is opt-in; reads never collect data.",
    };
  }
  receiveCommentEvent(accountId: string, externalMediaId: string, id: string, sentAt: number) {
    return this.receiveCommentEvents([{ accountId, externalMediaId, id, sentAt }]);
  }
  receiveCommentEvents(events: CommentEvent[]) {
    return this.store.receiveCommentEvents(events, this.clock());
  }
  confirmCommentSubscription(accountId: string) {
    return this.store.confirmCommentSubscription(accountId, this.clock());
  }
  async schedule(accountId: string): Promise<CollectionSchedule> {
    await this.analytics.account(accountId);
    return (
      (await this.store.schedule(accountId)) ?? {
        accountId,
        enabled: false,
        discoveryMinutes: 60,
        timeZone: "UTC",
        nextCatalogueAt: this.clock() + 30 * 86_400_000,
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
  async configure(
    accountId: string,
    input: { enabled: boolean; discoveryMinutes: number; timeZone?: string },
  ) {
    const previous = await this.schedule(accountId);
    const timeZone = input.timeZone ?? previous.timeZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(0);
    } catch {
      throw new ApplicationError("VALIDATION_FAILED", "Use a valid IANA time zone.");
    }
    const now = this.clock();
    const bringDiscoveryForward =
      input.enabled && (!previous.enabled || input.discoveryMinutes < previous.discoveryMinutes);
    await this.store.saveSchedule({
      ...previous,
      ...input,
      timeZone,
      nextDiscoveryAt: bringDiscoveryForward
        ? Math.min(previous.nextDiscoveryAt, now)
        : previous.nextDiscoveryAt,
      nextInsightsAt: timeZone === previous.timeZone ? previous.nextInsightsAt : now,
      updatedAt: now,
      retryAt: 0,
      failures: 0,
    });
    await this.store.recordPolicy(accountId, input.enabled, now, {
      version: "collection-v2",
      discoveryMinutes: input.discoveryMinutes,
      timeZone,
      windows: ageSnapshotWindows,
    });
    if (!input.enabled || timeZone !== previous.timeZone)
      for (const job of await this.store.jobs(accountId))
        if (
          job.automatic &&
          job.status === "running" &&
          (!input.enabled || job.origin === "activity")
        )
          await this.store.control(job.id, "cancelled", this.clock());
    return this.schedule(accountId);
  }
  private async workPlan(now: number) {
    const jobs = await this.store.pendingJobs();
    const schedules = await this.store.enabledSchedules();
    const candidates: WorkCandidate[] = [];
    const contexts = new Map<
      string,
      {
        schedule: CollectionSchedule;
        age: Awaited<ReturnType<CollectionStore["dueAgeMedia"]>>;
        storyExpiry: number | null;
        refreshMediaId?: string | null;
        commentMedia?: CataloguePosition | null;
      }
    >();
    for (const schedule of schedules) {
      const age = await this.store.dueAgeMedia(schedule.accountId, now);
      const storyExpiry = await this.store.nextStoryExpiry(schedule.accountId, now);
      const deadline = Math.min(
        schedule.nextDiscoveryAt + 900_000,
        schedule.nextStoriesAt + 1_800_000,
        storyExpiry ?? Infinity,
        age?.deadline ?? Infinity,
        schedule.nextInsightsAt + 21_600_000,
        schedule.nextCatalogueAt + 86_400_000,
      );
      let dueAt = Math.min(
        schedule.nextDiscoveryAt,
        schedule.nextStoriesAt,
        schedule.nextInsightsAt,
        schedule.nextCatalogueAt,
        age ? now : Infinity,
        storyExpiry !== null ? storyExpiry - storyFinalSnapshotWindowMs : Infinity,
      );
      let refreshMediaId: string | null | undefined;
      let commentMedia: CataloguePosition | null | undefined;
      if (dueAt > now) {
        refreshMediaId = await this.store.dueMedia(schedule.accountId, now);
        if (!refreshMediaId)
          commentMedia = (await this.comments.enabled(schedule.accountId))
            ? await this.store.nextCommentRefresh(schedule.accountId, now)
            : null;
        if (refreshMediaId || commentMedia) dueAt = now;
      }
      candidates.push({
        kind: "schedule",
        id: schedule.accountId,
        dueAt: Math.max(schedule.retryAt, schedule.claimExpiresAt ?? 0, dueAt),
        deadline,
        archive: false,
      });
      contexts.set(schedule.accountId, {
        schedule,
        age,
        storyExpiry,
        refreshMediaId,
        commentMedia,
      });
    }
    for (const job of jobs) {
      let deadline = ["stories", "scheduled", "comments_refresh"].includes(job.origin)
        ? job.nextAttemptAt + 900_000
        : Number.MAX_SAFE_INTEGER;
      if (job.origin === "activity") {
        const period = (JSON.parse(job.cursor ?? "[]") as ActivityPeriod[])[0];
        if (period) deadline = period.from + 90 * 86_400_000;
      }
      candidates.push({
        kind: "job",
        id: job.id,
        dueAt: Math.max(job.nextAttemptAt, job.leaseExpiresAt ?? 0),
        deadline,
        archive: !["stories", "scheduled", "comments_refresh"].includes(job.origin),
        lastAttemptAt: job.lastAttemptAt,
      });
    }
    return { candidates, contexts };
  }
  async nextWakeAt() {
    const now = this.clock();
    const next = await this.store.nextWakeAt(now, collectionExecution.idleCheckMs);
    return next === null ? null : Math.max(now + collectionExecution.continuationDelayMs, next);
  }
  async tick(sequence = this.selectionSequence++) {
    const now = this.clock();
    const { candidates, contexts } = await this.workPlan(now);
    const decision = selectWork(candidates, now, sequence);
    if (!decision.selected) return { decision, httpAttempts: 0, durationMs: 0 };
    if (decision.selected.kind === "job") {
      const job = await this.advance(decision.selected.id);
      return {
        decision,
        httpAttempts: job.lastStepHttpAttempts ?? null,
        durationMs: this.clock() - now,
      };
    }
    const context = contexts.get(decision.selected.id);
    if (!context) return;
    const { schedule, age, storyExpiry } = context;
    const scheduleToken = this.randomId();
    if (!(await this.store.claimSchedule(schedule.accountId, scheduleToken, now)))
      return { decision, deferred: "lease_contention" };
    schedule.claimToken = scheduleToken;
    let refreshingMedia: string | null = null;
    try {
      const now = this.clock();
      await this.store.recordPolicy(schedule.accountId, true, now, {
        version: "collection-v2",
        discoveryMinutes: schedule.discoveryMinutes,
        timeZone: schedule.timeZone,
        windows: ageSnapshotWindows,
      });
      let lastSuccessAt = schedule.lastSuccessAt;

      const urgentStory =
        storyExpiry !== null && storyExpiry - storyFinalSnapshotWindowMs < schedule.nextStoriesAt;
      // Pick the oldest deadline so a backlog of age snapshots cannot prevent
      // short-lived Stories and newly published media from being discovered.
      const periodic = [
        {
          kind: "stories",
          dueAt: urgentStory
            ? (storyExpiry ?? now) - storyFinalSnapshotWindowMs
            : schedule.nextStoriesAt,
          graceMs: urgentStory ? storyFinalSnapshotWindowMs : 30 * 60_000,
        },
        { kind: "discovery", dueAt: schedule.nextDiscoveryAt, graceMs: 15 * 60_000 },
        { kind: "insights", dueAt: schedule.nextInsightsAt, graceMs: 6 * 3_600_000 },
        { kind: "catalogue", dueAt: schedule.nextCatalogueAt, graceMs: 24 * 3_600_000 },
      ]
        .filter((task) => task.dueAt <= now)
        .sort((a, b) => a.dueAt + a.graceMs - b.dueAt - b.graceMs)[0];
      if (age && (!periodic || age.deadline < periodic.dueAt + periodic.graceMs)) {
        refreshingMedia = age.mediaId;
        const result = await this.analytics.refresh(
          age.mediaId,
          await this.operationId(
            `age:${age.mediaId}:${age.targetHours}:${Math.floor(now / retryIntervalMs)}`,
          ),
        );
        if (result.status !== "completed")
          throw incompleteOperationError(result.status, result.errorCode);
        lastSuccessAt = result.completedAt;
      } else if (periodic?.kind === "stories") {
        const id = await this.operationId(
          `stories:${schedule.accountId}:${schedule.nextStoriesAt}`,
        );
        if ((await this.store.latestJob(schedule.accountId, "stories"))?.status !== "running")
          await this.start(schedule.accountId, id, "stories", true);
        const storyJob = await this.store.latestJob(schedule.accountId, "stories");
        if (storyJob) await this.advance(storyJob.id);
        schedule.nextStoriesAt = now + 60 * 60_000;
      } else if (periodic?.kind === "insights") {
        const key = `account-insights:${schedule.accountId}:${schedule.nextInsightsAt}`;
        const plan = await this.analytics.activityPlan(schedule.accountId, schedule.timeZone, now);
        const activity = await this.store.latestJob(schedule.accountId, "activity");
        if (activity?.status === "running") {
          const periods = refreshActivityQueue(
            JSON.parse(activity.cursor ?? "[]") as ActivityPeriod[],
            plan.periods,
          );
          if (!(await this.store.replanActivity(activity, periods, now)))
            throw new ApplicationError(
              "SYNC_IN_PROGRESS",
              "The activity job changed or is leased; retry the daily plan.",
            );
        } else {
          if (plan.periods.length)
            await this.start(
              schedule.accountId,
              await this.operationId(key),
              "activity",
              true,
              undefined,
              plan.periods,
            );
        }
        await this.supporting(schedule.accountId, key, true);
        const activityJob = await this.store.latestJob(schedule.accountId, "activity");
        if (activityJob) await this.advance(activityJob.id);
        schedule.nextInsightsAt = now + 24 * 60 * 60_000;
      } else if (periodic?.kind === "catalogue") {
        if ((await this.store.latestJob(schedule.accountId, "catalogue"))?.status !== "running")
          await this.start(
            schedule.accountId,
            await this.operationId(`catalogue:${schedule.accountId}:${schedule.nextCatalogueAt}`),
            "catalogue",
            true,
          );
        const catalogueJob = await this.store.latestJob(schedule.accountId, "catalogue");
        if (catalogueJob) await this.advance(catalogueJob.id);
        schedule.nextCatalogueAt = now + 30 * 86_400_000;
      } else if (periodic?.kind === "discovery") {
        const id = await this.operationId(
          `discovery:${schedule.accountId}:${schedule.nextDiscoveryAt}`,
        );
        if ((await this.store.latestJob(schedule.accountId, "scheduled"))?.status !== "running")
          await this.start(schedule.accountId, id, "scheduled");
        const discoveryJob = await this.store.latestJob(schedule.accountId, "scheduled");
        if (discoveryJob) await this.advance(discoveryJob.id);
        schedule.nextDiscoveryAt = now + schedule.discoveryMinutes * 60_000;
      } else {
        const commentMedia =
          context.commentMedia === undefined
            ? (await this.comments.enabled(schedule.accountId))
              ? await this.store.nextCommentRefresh(schedule.accountId, now)
              : null
            : context.commentMedia;
        const mediaId =
          context.refreshMediaId === undefined
            ? await this.store.dueMedia(schedule.accountId, now)
            : context.refreshMediaId;
        const preferComments = sequence % 2 === 0;
        if (commentMedia && (!mediaId || preferComments)) {
          await this.start(
            schedule.accountId,
            await this.operationId(
              `comments-refresh:${commentMedia.id}:${Math.floor(now / retryIntervalMs)}`,
            ),
            "comments_refresh",
            true,
            commentMedia,
          );
          const refreshJob = await this.store.latestJob(schedule.accountId, "comments_refresh");
          if (refreshJob) await this.advance(refreshJob.id);
        } else if (mediaId) {
          refreshingMedia = mediaId;
          const result = await this.analytics.refresh(
            mediaId,
            // A source-error cooldown is five minutes. A larger identity
            // window replays the same completed partial page after it expires.
            await this.operationId(`refresh:${mediaId}:${Math.floor(now / retryIntervalMs)}`),
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
          retryAt: this.clock() + collectionExecution.continuationDelayMs,
        },
        schedule.updatedAt,
      );
    } catch (error) {
      const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      const objectDelay = objectFailureDelay(code);
      if (objectDelay !== null && refreshingMedia) {
        await this.store.markUnavailable(
          refreshingMedia,
          this.clock() +
            Math.max(
              objectDelay,
              error instanceof ApplicationError ? (error.retryAfterMs ?? 0) : 0,
            ),
          code,
        );
        await this.store.finishSchedule(
          {
            ...schedule,
            errorCode: null,
            failures: 0,
            retryAt: this.clock() + collectionExecution.continuationDelayMs,
          },
          schedule.updatedAt,
        );
        return;
      }
      const recoverable =
        code === "SYNC_IN_PROGRESS" ||
        code === "SYNC_LEASE_EXPIRED" ||
        code === "COLLECTION_EXPIRED" ||
        [
          "REQUEST_BUDGET_EXHAUSTED",
          "INSTAGRAM_RATE_LIMITED",
          "INSTAGRAM_AUTH_EXPIRED",
          "INSTAGRAM_PERMISSION_REQUIRED",
        ].includes(code);
      const retryAt =
        this.clock() +
        Math.max(
          code === "INSTAGRAM_RATE_LIMITED"
            ? 15 * 60_000
            : recoverable || (age !== null && code === "INSTAGRAM_UNAVAILABLE")
              ? retryIntervalMs
              : retryDelay(schedule.failures + 1),
          error instanceof ApplicationError ? (error.retryAfterMs ?? 0) : 0,
        );
      await this.store.finishSchedule(
        {
          ...schedule,
          errorCode: code,
          failures: schedule.failures + (recoverable ? 0 : 1),
          retryAt,
        },
        schedule.updatedAt,
      );
    } finally {
      await this.store.releaseSchedule(schedule.accountId, scheduleToken);
    }
  }
}
