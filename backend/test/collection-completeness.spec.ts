import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { featureOptions } from "../src/app/create-features";
import type { createAnalyticsOperations } from "../src/modules/analytics";
import { createCollectionOperations } from "../src/modules/collection";
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
