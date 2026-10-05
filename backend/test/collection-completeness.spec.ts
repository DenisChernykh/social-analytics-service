import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledOperations, featureOptions } from "../src/app/create-features";
import { createAnalyticsOperations } from "../src/modules/analytics";
import { createCollectionOperations } from "../src/modules/collection";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});
const mediaId = `${accountId}_${sampleMedia.id}`;
type HistoryPage = Awaited<
  ReturnType<ReturnType<typeof createAnalyticsOperations>["queries"]["accountHistory"]>
>;
type Job = Awaited<ReturnType<ReturnType<typeof createCollectionOperations>["advance"]>>;
type Status = Awaited<ReturnType<ReturnType<typeof createCollectionOperations>["status"]>>;
async function ready(comments = false) {
  const f = fixture();
  if (comments)
    vi.mocked(f.transport.exchangeCode).mockResolvedValue({
      accessToken: "fake-short-token",
      scopes: [
        "instagram_business_basic",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments",
      ],
    });
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  return f;
}

describe("complete saved account history", () => {
  it("reads beyond 100 observations without duplicates at equal times and computes change over the whole selected range", async () => {
    const f = await ready();
    await env.DB.batch(
      Array.from({ length: 120 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO account_snapshots (id,account_id,observed_at,followers_count,media_count) VALUES (?,?,?,?,?)",
        ).bind(
          `history-${String(index).padStart(3, "0")}`,
          accountId,
          f.now() + Math.floor(index / 3) * 1000,
          1000 + index,
          10 + index,
        ),
      ),
    );
    const first = (await (
      await f.request(`/api/accounts/${accountId}/history?limit=100`)
    ).json()) as HistoryPage;
    expect(first.items).toHaveLength(100);
    expect(first).toMatchObject({
      nextCursor: expect.any(String),
      followerNetChange: 119,
      coverage: {
        totalObservations: 121,
        fromSnapshot: f.now(),
        toSnapshot: f.now() + 39000,
        truncated: true,
      },
    });
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "17" });
      if (cursor) query.set("cursor", cursor);
      const page = (await (
        await f.request(`/api/accounts/${accountId}/history?${query}`)
      ).json()) as HistoryPage;
      expect(page.followerNetChange).toBe(119);
      for (const item of page.items) {
        const key = JSON.stringify(item);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(121);
    const filtered = new URLSearchParams({
      from: new Date(f.now() + 10000).toISOString(),
      to: new Date(f.now() + 20000).toISOString(),
      limit: "5",
    });
    expect(
      await (await f.request(`/api/accounts/${accountId}/history?${filtered}`)).json(),
    ).toMatchObject({ followerNetChange: 32, coverage: { totalObservations: 33 } });
    if (!first.nextCursor) throw new Error("Expected an additional history page");
    filtered.set("cursor", first.nextCursor);
    expect((await f.request(`/api/accounts/${accountId}/history?${filtered}`)).status).toBe(400);
    expect((await f.request(`/api/accounts/${accountId}/history?cursor=invalid`)).status).toBe(400);
  });
});

describe("complete analytical cohorts", () => {
  it("includes older publications beyond the first 100 in rankings, lifetime comparisons and filtered summaries", async () => {
    const f = await ready();
    const publishedAt = f.now() - 7 * 86_400_000 - 120_000;
    await env.DB.batch(
      Array.from({ length: 120 }, (_, index) => {
        const id = `catalogue-${String(index).padStart(3, "0")}`;
        return [
          env.DB.prepare(
            "INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at,context_json) SELECT ?,account_id,?,caption,search_text,media_type,product_type,permalink,?,updated_at,? FROM media WHERE id=?",
          ).bind(
            id,
            id,
            publishedAt + index * 1000,
            JSON.stringify({
              confirmed: { rubric: "Long cohort" },
              proposal: {},
              confirmedSource: "manual",
              proposalSource: "assistant_suggestion",
              updatedAt: f.now(),
            }),
            mediaId,
          ),
          env.DB.prepare(
            "INSERT INTO media_snapshots (id,media_id,observed_at,api_version,metrics_json) SELECT ?,?,?,api_version,json_set(metrics_json,'$.reach.value',?) FROM media_snapshots WHERE media_id=? LIMIT 1",
          ).bind(
            `snapshot-${id}`,
            id,
            publishedAt + index * 1000 + 7 * 86_400_000,
            index === 0 ? 5000 : 1000,
            mediaId,
          ),
        ];
      }).flat(),
    );
    const response = await f.request(
      `/api/accounts/${accountId}/content-analysis?ageDays=7&productType=REELS`,
    );
    expect(response.status).toBe(200);
    const ranking = (await response.json()) as {
      items: { media: { id: string }; absolute: number | null; sampleSize: number }[];
      coverage: { examined: number; observed: number; missing: number; truncated: boolean };
    };
    expect(ranking.coverage).toMatchObject({
      examined: 121,
      observed: 120,
      missing: 1,
      truncated: false,
    });
    expect(ranking.items[0]).toMatchObject({
      media: { id: "catalogue-000" },
      absolute: 5000,
      sampleSize: 119,
    });
    expect(new Set(ranking.items.map((item) => item.media.id)).size).toBe(121);
    expect(await (await f.request(`/api/media/catalogue-000/benchmark`)).json()).toMatchObject({
      cohort: { examined: 121, snapshots: 120, truncated: false },
    });
    expect(
      await (await f.request(`/api/accounts/${accountId}/summary?rubric=Long%20cohort`)).json(),
    ).toMatchObject({
      cohort: { mediaCount: 120, truncated: false },
      totals: { views: { available: 120 } },
    });
    expect(
      await (
        await f.request(`/api/accounts/${accountId}/content-analysis?rubric=Long%20cohort`)
      ).json(),
    ).toMatchObject({ coverage: { examined: 120, observed: 120, missing: 0, truncated: false } });
  });
  it("provides all saved media snapshots to experiment and review evidence", async () => {
    const f = await ready();
    await env.DB.batch(
      Array.from({ length: 120 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO media_snapshots (id,media_id,observed_at,api_version,metrics_json) SELECT ?,media_id,?,api_version,metrics_json FROM media_snapshots WHERE media_id=? LIMIT 1",
        ).bind(`older-${String(index).padStart(3, "0")}`, f.now() - (index + 1) * 1000, mediaId),
      ),
    );
    const options = featureOptions({ transport: () => f.transport }, f.now);
    const analytics = createAnalyticsOperations(env, options.analyticsOptions);
    const history = await analytics.queries.savedHistory(mediaId);
    expect(history.items).toHaveLength(121);
    expect(history.truncated).toBe(false);
    expect(new Set(history.items.map((item) => item.id)).size).toBe(121);
    expect(history.items.at(-1)?.observedAt).toBe(f.now() - 120_000);
    expect(await options.contentOptions.analytics(env).history(mediaId)).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: "older-119" })]),
      truncated: false,
    });
    expect(await options.reviewOptions.evidence(env).history(mediaId)).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: "older-119" })]),
      truncated: false,
    });
  });
});

describe("audience windows and account-wide comments", () => {
  it("rejects removed engaged-demography windows and still allows reading older saved follower windows", async () => {
    const f = await ready();
    expect(
      (
        await f.request(`/api/accounts/${accountId}/audience/collect`, "POST", {
          operationId: crypto.randomUUID(),
          timeframe: "last_30_days",
          breakdown: "age",
        })
      ).status,
    ).toBe(400);
    expect(f.transport.structuredInsights).not.toHaveBeenCalled();
    expect(
      (await f.request(`/api/accounts/${accountId}/audience?timeframe=last_30_days&breakdown=age`))
        .status,
    ).toBe(200);
    expect(
      (
        await f.request(`/api/accounts/${accountId}/audience/collect`, "POST", {
          operationId: crypto.randomUUID(),
          timeframe: "this_month",
          breakdown: "age",
        })
      ).status,
    ).toBe(200);
    expect(
      vi
        .mocked(f.transport.structuredInsights)
        .mock.calls.every((call) => call[2].timeframe === "this_month"),
    ).toBe(true);
  });
  it("exhausts empty intermediate pages, all reply pages and the entire non-Story catalogue, with resumable progress", async () => {
    const f = await ready(true);
    const second = {
      ...sampleMedia,
      id: "17900000000000002",
      timestamp: sampleMedia.timestamp - 1000,
    };
    vi.mocked(f.transport.mediaPage).mockResolvedValueOnce({
      media: [second, { ...sampleMedia, id: "17900000000000003", productType: "STORY" }],
      nextCursor: null,
    });
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    vi.mocked(f.transport.comments).mockImplementation(
      async (_token, objectId, replies, cursor) => {
        if (replies) {
          if (objectId === "111")
            return cursor
              ? {
                  items: [{ id: "212", text: "Second reply", publishedAt: 2000 }],
                  nextCursor: null,
                }
              : {
                  items: [{ id: "211", text: "First reply", publishedAt: 1000 }],
                  nextCursor: "reply-next",
                };
          return { items: [], nextCursor: null };
        }
        if (objectId === second.id) return { items: [], nextCursor: null };
        if (!cursor) return { items: [], nextCursor: "first-empty" };
        if (cursor === "first-empty")
          return {
            items: [
              { id: "111", text: "Question?", publishedAt: 1000 },
              { id: "112", text: "Comment", publishedAt: 1100 },
            ],
            nextCursor: "second",
          };
        return {
          items: [{ id: "113", text: "Last comment", publishedAt: 1200 }],
          nextCursor: null,
        };
      },
    );
    const operationId = crypto.randomUUID();
    expect(
      (await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", { operationId }))
        .status,
    ).toBe(200);
    const advance = async () =>
      (await (
        await f.request(`/api/collection-jobs/${operationId}/advance`, "POST", {})
      ).json()) as Job;
    expect(await advance()).toMatchObject({
      status: "running",
      pages: 1,
      collected: 0,
      mediaProcessed: 0,
    });
    let job = await advance();
    await f.request(`/api/collection-jobs/${operationId}`, "PATCH", { action: "cancel" });
    expect(await advance()).toMatchObject({ status: "cancelled", pages: 2 });
    await f.request(`/api/collection-jobs/${operationId}`, "PATCH", { action: "resume" });
    for (let attempt = 0; job.status === "running" && attempt < 20; attempt++)
      job = await advance();
    expect(job).toMatchObject({
      status: "completed",
      origin: "comments",
      automatic: false,
      pages: 8,
      mediaProcessed: 2,
      collected: 5,
      cursor: null,
    });
    expect(await advance()).toMatchObject({ pages: 8, collected: 5 });
    expect(f.transport.comments).toHaveBeenCalledTimes(8);
    expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "212", parentId: "111" }),
        expect.objectContaining({ id: "113" }),
      ]),
    });
  });
  it("queues audience and granted comments after the primary pass and preserves manual jobs when the schedule is disabled", async () => {
    const f = await ready(true);
    const operationId = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/collection`, "POST", { operationId });
    await f.request(`/api/collection-jobs/${operationId}/advance`, "POST", {});
    const status = (await (
      await f.request(`/api/accounts/${accountId}/collection`)
    ).json()) as Status;
    expect(status.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "audience", automatic: false, status: "running" }),
        expect.objectContaining({ origin: "comments", automatic: false, status: "running" }),
      ]),
    );
    expect(f.transport.comments).not.toHaveBeenCalled();
    await f.request(`/api/accounts/${accountId}/collection/schedule`, "PATCH", { enabled: false });
    const collector = createCollectionOperations(
      env,
      featureOptions({ transport: () => f.transport }, f.now).collectionOptions,
    );
    for (let index = 0; index < 6; index++) await collector.tick();
    const completed = (await (
      await f.request(`/api/accounts/${accountId}/collection`)
    ).json()) as Status;
    expect(completed.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "audience", status: "completed", pages: 4 }),
        expect.objectContaining({ origin: "comments", status: "completed", mediaProcessed: 1 }),
      ]),
    );
    expect(f.transport.comments).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.transport.structuredInsights).mock.calls).toHaveLength(8);
  });
  it("repairs flat replies saved as roots and queries replies only for actual root comments", async () => {
    const f = await ready(true);
    vi.mocked(f.transport.comments).mockResolvedValueOnce({
      items: [{ id: "222", text: "Legacy reply", publishedAt: 2000 }],
      nextCursor: null,
    });
    await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
      operationId: crypto.randomUUID(),
    });
    f.advance(1000);
    vi.mocked(f.transport.comments).mockImplementation(async (_token, objectId, replies) => {
      if (replies) {
        expect(objectId).toBe("111");
        return {
          items: [{ id: "222", text: "Current reply", publishedAt: 2000 }],
          nextCursor: null,
        };
      }
      return {
        items: [
          { id: "111", text: "Root", publishedAt: 1000, parentId: null },
          { id: "222", text: "Current reply", publishedAt: 2000, parentId: "111" },
          { id: "333", text: "Other reply", publishedAt: 3000, parentId: "999" },
        ],
        nextCursor: null,
      };
    });
    const jobId = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", {
      operationId: jobId,
    });
    const advance = async () =>
      (await (await f.request(`/api/collection-jobs/${jobId}/advance`, "POST", {})).json()) as Job;
    const first = await advance();
    expect(JSON.parse(first.cursor ?? "null")).toMatchObject({ parents: ["111"] });
    expect(await advance()).toMatchObject({
      status: "completed",
      pages: 2,
      mediaProcessed: 1,
      collected: 4,
    });
    f.advance(1000);
    vi.mocked(f.transport.comments).mockResolvedValueOnce({
      items: [{ id: "222", text: "Updated sparse reply", publishedAt: 2000 }],
      nextCursor: null,
    });
    await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
      operationId: crypto.randomUUID(),
    });
    expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
      items: [
        { id: "333", parentId: "999" },
        { id: "222", parentId: "111", text: "Updated sparse reply" },
        { id: "111", parentId: null },
      ],
    });
    expect(
      vi
        .mocked(f.transport.comments)
        .mock.calls.filter((call) => call[2])
        .map((call) => call[1]),
    ).toEqual(["111"]);
    expect(
      (
        await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
          operationId: crypto.randomUUID(),
          parentId: "222",
        })
      ).status,
    ).toBe(404);
  });
  it("continues a legacy cursor after one of its queued parents is reclassified as a reply", async () => {
    const f = await ready(true);
    vi.mocked(f.transport.comments).mockImplementation(async (_token, objectId, replies) => {
      if (replies) {
        expect(objectId).toBe("111");
        return {
          items: [{ id: "222", text: "Reply", publishedAt: 2000 }],
          nextCursor: null,
        };
      }
      return {
        items: [
          { id: "111", text: "Root", publishedAt: 1000 },
          { id: "222", text: "Reply", publishedAt: 2000 },
        ],
        nextCursor: null,
      };
    });
    const jobId = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", {
      operationId: jobId,
    });
    const advance = async () =>
      (await (await f.request(`/api/collection-jobs/${jobId}/advance`, "POST", {})).json()) as Job;
    expect(JSON.parse((await advance()).cursor ?? "null")).toMatchObject({
      parents: ["111", "222"],
    });
    expect(
      await (
        await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
          operationId: crypto.randomUUID(),
          parentId: "111",
        })
      ).json(),
    ).toMatchObject({ status: "completed", collected: 1, commentIds: ["222"] });
    expect(await advance()).toMatchObject({ status: "running", pages: 2, collected: 3 });
    expect(await advance()).toMatchObject({
      status: "completed",
      pages: 3,
      mediaProcessed: 1,
      collected: 3,
      errorCode: null,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(3);
    expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
      items: [
        { id: "222", parentId: "111" },
        { id: "111", parentId: null },
      ],
    });
  });
  it("requires granted permission for bulk collection", async () => {
    const f = await ready();
    expect(
      (
        await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(f.transport.comments).not.toHaveBeenCalled();
  });
});

describe("bounded background comment progress", () => {
  it("performs one collection step per tick and gives both background jobs and the schedule a turn", async () => {
    const f = await ready(true);
    vi.mocked(f.transport.comments).mockImplementation(async (_token, _id, _replies, cursor) => ({
      items: [],
      nextCursor: String(Number(cursor ?? 0) + 1),
    }));
    const jobId = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", { operationId: jobId });
    await f.request(`/api/accounts/${accountId}/collection/schedule`, "PATCH", { enabled: true });
    // Start at a schedule-preferred slot.
    f.advance(600_000 - (f.now() % 600_000));
    const collector = createScheduledOperations(env, { transport: () => f.transport }, f.now);
    await collector.tick();
    expect(f.transport.comments).not.toHaveBeenCalled();
    expect(f.transport.stories).not.toHaveBeenCalled();
    expect(await collector.status(accountId)).toMatchObject({
      schedule: { nextStoriesAt: f.now() + 60 * 60_000 },
      policy: { cronMinutes: 5, runBudget: 1 },
    });
    f.advance(5 * 60_000);
    await collector.tick();
    expect(f.transport.stories).toHaveBeenCalledTimes(1);
    expect(f.transport.comments).not.toHaveBeenCalled();
    f.advance(5 * 60_000);
    await collector.tick();
    expect(await collector.job(jobId)).toMatchObject({ status: "running", pages: 1 });
    expect(f.transport.structuredInsights).not.toHaveBeenCalled();
    f.advance(10 * 60_000);
    await collector.tick();
    expect(f.transport.structuredInsights).toHaveBeenCalled();
    expect(await collector.job(jobId)).toMatchObject({ pages: 1 });
    expect((await collector.status(accountId)).schedule.nextInsightsAt).toBeGreaterThan(f.now());
  });
  it("stops the affected job at source backoff and resumes its saved cursor later", async () => {
    const f = await ready(true);
    vi.mocked(f.transport.comments).mockImplementation(async (_token, _id, _replies, cursor) => ({
      items: [],
      nextCursor: cursor ? null : "next-page",
    }));
    const jobId = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", { operationId: jobId });
    const collector = createScheduledOperations(env, { transport: () => f.transport }, f.now);
    await collector.tick();
    vi.mocked(f.transport.comments).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_RATE_LIMITED", "Temporary source failure"),
    );
    await collector.tick();
    expect(await collector.job(jobId)).toMatchObject({
      pages: 1,
      status: "running",
      errorCode: "INSTAGRAM_RATE_LIMITED",
      nextAttemptAt: f.now() + 30 * 60_000,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(2);
    await collector.tick();
    expect(f.transport.comments).toHaveBeenCalledTimes(2);
    f.advance(30 * 60_000);
    await collector.tick();
    expect(await collector.job(jobId)).toMatchObject({
      status: "completed",
      pages: 2,
      mediaProcessed: 1,
      errorCode: null,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(3);
    expect(vi.mocked(f.transport.comments).mock.calls.at(-1)?.[3]).toBe("next-page");
    expect((await collector.status(accountId)).schedule.enabled).toBe(false);
  });
  it("does not let another worker's lease prevent a different due job from progressing", async () => {
    const f = await ready(true);
    const leased = crypto.randomUUID();
    const available = crypto.randomUUID();
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", {
      operationId: leased,
    });
    f.advance(1);
    await f.request(`/api/accounts/${accountId}/comments/collect`, "POST", {
      operationId: available,
    });
    await env.DB.prepare("UPDATE collection_jobs SET lease_token=?,lease_expires_at=? WHERE id=?")
      .bind("other-worker", f.now() + 15 * 60_000, leased)
      .run();
    const collector = createCollectionOperations(
      env,
      featureOptions({ transport: () => f.transport }, f.now).collectionOptions,
    );
    await collector.tick();
    expect(await collector.job(leased)).toMatchObject({ status: "running", pages: 0 });
    expect(await collector.job(available)).toMatchObject({ status: "completed", pages: 1 });
    expect(f.transport.comments).toHaveBeenCalledTimes(1);
  });
});
