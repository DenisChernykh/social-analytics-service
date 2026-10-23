import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import type { InsightCollection } from "../src/modules/account-insights/domain/model";
import { D1Insights } from "../src/modules/account-insights/infrastructure/d1-insights";
import { createCommentRecovery } from "../src/modules/collection";
import type { CommentCollection } from "../src/modules/community/domain/model";
import { D1Comments } from "../src/modules/community/infrastructure/d1-comments";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});
async function ready() {
  const f = fixture();
  vi.mocked(f.transport.exchangeCode).mockResolvedValue({
    accessToken: "fake-token",
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
const mediaId = `${accountId}_${sampleMedia.id}`;
const insight = (at: number): InsightCollection => ({
  id: crypto.randomUUID(),
  accountId,
  status: "running",
  requestedAt: at,
  observedAt: null,
  apiVersion: "v26.0",
  provider: "instagram_api",
  scope: "instagram_audience_timeframe",
  aggregation: "timeframe",
  object: "audience",
  input: {
    kind: "demographics",
    metricType: "total_value",
    metrics: [],
    timeZone: "UTC",
    timeframe: "this_month",
  },
  values: [],
  errorCode: null,
});
const page = (at: number, jobId?: string): CommentCollection => ({
  id: crypto.randomUUID(),
  mediaId,
  status: "running",
  startedAt: at,
  observedAt: null,
  parentId: null,
  cursor: null,
  nextCursor: null,
  limit: 50,
  collected: 0,
  commentIds: [],
  errorCode: null,
  ...(jobId ? { jobId } : {}),
});

describe("expired attempt recovery", () => {
  it("closes old reservations without inventing observation time and fences delayed writers", async () => {
    const f = await ready(),
      insights = new D1Insights(env.DB),
      comments = new D1Comments(env.DB);
    const oldInsight = insight(f.now() - 900_000),
      oldPage = page(f.now() - 900_000);
    const freshInsight = insight(f.now() - 1000),
      freshPage = page(f.now() - 1000);
    await insights.reserve(oldInsight);
    await insights.reserve(freshInsight);
    await comments.reserve(oldPage);
    await comments.reserve(freshPage);
    expect(await insights.expireAttempts(f.now())).toBe(1);
    expect(await comments.expireAttempts(f.now())).toBe(1);
    expect(await insights.collection(oldInsight.id)).toMatchObject({
      status: "failed",
      errorCode: "COLLECTION_EXPIRED",
      observedAt: null,
      requestedAt: oldInsight.requestedAt,
    });
    expect(await comments.collection(oldPage.id)).toMatchObject({
      status: "failed",
      errorCode: "COLLECTION_EXPIRED",
      observedAt: null,
      startedAt: oldPage.startedAt,
    });
    expect(await insights.finish({ ...oldInsight, status: "completed", observedAt: f.now() })).toBe(
      false,
    );
    expect(
      await comments.finish(
        { ...oldPage, status: "completed", observedAt: f.now() },
        [
          {
            id: "late",
            mediaId,
            parentId: null,
            text: "late",
            publishedAt: f.now(),
            observedAt: f.now(),
          },
        ],
        f.now(),
      ),
    ).toBe(false);
    expect(await env.DB.prepare("SELECT id FROM comments WHERE id='late'").first()).toBeNull();
    expect(await insights.collection(freshInsight.id)).toMatchObject({ status: "running" });
    expect(await comments.collection(freshPage.id)).toMatchObject({ status: "running" });
    expect(await insights.expireAttempts(f.now())).toBe(0);
    expect(await comments.expireAttempts(f.now())).toBe(0);
  });
  it("protects active leases and processes a backlog in bounded portions", async () => {
    const f = await ready(),
      comments = new D1Comments(env.DB),
      insights = new D1Insights(env.DB);
    const executor = createCollectionExecutor(env, { transport: () => f.transport }, f.now);
    const job = await executor.start(accountId, crypto.randomUUID(), "audience");
    await env.DB.prepare(
      "UPDATE collection_jobs SET lease_token='held',lease_expires_at=? WHERE id=?",
    )
      .bind(f.now() + 60_000, job.id)
      .run();
    const protectedInsight = insight(f.now() - 1_000_000),
      protectedPage = page(f.now() - 1_000_000, job.id);
    await insights.reserve(protectedInsight);
    await comments.reserve(protectedPage);
    const oldPages = Array.from({ length: 101 }, () => page(f.now() - 1_000_000));
    await env.DB.batch(
      oldPages.map((p) =>
        env.DB.prepare(
          "INSERT INTO comment_collections(id,media_id,signature,observed_at,result_json) VALUES(?,?,'fixture',?,?)",
        ).bind(p.id, mediaId, p.startedAt, JSON.stringify(p)),
      ),
    );
    expect(await comments.expireAttempts(f.now())).toBe(100);
    expect(await comments.expireAttempts(f.now())).toBe(1);
    expect(await insights.expireAttempts(f.now())).toBe(0);
    expect(await comments.collection(protectedPage.id)).toMatchObject({ status: "running" });
    f.advance(60_000);
    expect(await comments.expireAttempts(f.now())).toBe(1);
    expect(await insights.expireAttempts(f.now())).toBe(1);
  });
  it("runs expiry from the real DO alarm and preserves its throttle across eviction", async () => {
    await ready();
    const comments = new D1Comments(env.DB);
    let time = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const install = () =>
      runInDurableObject(stub, (instance) => {
        vi.spyOn(
          instance as unknown as { executor(): ReturnType<typeof createCollectionExecutor> },
          "executor",
        ).mockReturnValue({
          tick: async () => {},
          nextWakeAt: async () => time + 1000,
        } as unknown as ReturnType<typeof createCollectionExecutor>);
      });
    await install();
    const first = page(time - 900_000);
    await comments.reserve(first);
    await stub.ensureAwake();
    await runDurableObjectAlarm(stub);
    expect(await comments.collection(first.id)).toMatchObject({
      status: "failed",
      errorCode: "COLLECTION_EXPIRED",
    });
    const second = page(time - 900_000);
    await comments.reserve(second);
    await evictDurableObject(stub);
    await install();
    await runDurableObjectAlarm(stub);
    expect(await comments.collection(second.id)).toMatchObject({ status: "running" });
    time += 300_000;
    await runDurableObjectAlarm(stub);
    expect(await comments.collection(second.id)).toMatchObject({
      status: "failed",
      errorCode: "COLLECTION_EXPIRED",
    });
    vi.restoreAllMocks();
  });

  it("queues only incomplete enabled publications after active old passes have finished", async () => {
    const f = await ready();
    const executor = createCollectionExecutor(env, { transport: () => f.transport }, f.now);
    await executor.configure(accountId, { enabled: true, discoveryMinutes: 60, timeZone: "UTC" });
    await env.DB.prepare(
      "INSERT INTO comment_media_state(media_id,omitted_branches,next_refresh_at,last_complete_at,unique_saved) VALUES(?,3,?,?,7)",
    )
      .bind(mediaId, f.now() + 86_400_000, f.now() - 1000)
      .run();
    const recovery = createCommentRecovery(env);
    const active = await executor.start(accountId, crypto.randomUUID(), "comments");
    expect(await recovery.queueIncomplete(f.now())).toBe(false);
    await executor.control(active.id, "cancel");
    expect(await recovery.queueIncomplete(f.now())).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT omitted_branches,next_refresh_at,last_complete_at,unique_saved FROM comment_media_state WHERE media_id=?",
      )
        .bind(mediaId)
        .first(),
    ).toEqual({
      omitted_branches: 3,
      next_refresh_at: f.now(),
      last_complete_at: f.now() - 1000,
      unique_saved: 7,
    });
  });
});
