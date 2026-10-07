import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledOperations } from "../src/app/create-features";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

const mediaId = `${accountId}_${sampleMedia.id}`;
const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "https://example.test/callback",
  apiVersion: "v26.0",
};
const comment = (id: string, parentId?: string) => ({
  id,
  text: `Comment ${id}`,
  timestamp: "2026-10-01T10:00:00Z",
  ...(parentId ? { parent_id: parentId } : {}),
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready(request?: typeof fetch) {
  const f = fixture();
  vi.mocked(f.transport.exchangeCode).mockResolvedValue({
    accessToken: "fake-token",
    scopes: [
      "instagram_business_basic",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
    ],
  });
  if (request) {
    const client = new MetaClient(config, request);
    vi.mocked(f.transport.comments).mockImplementation((...args) => client.comments(...args));
  }
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  return {
    ...f,
    collector: createScheduledOperations(env, { transport: () => f.transport }, f.now),
    store: new D1Collection(env.DB),
  };
}

describe("bounded expanded comment collection (#18)", () => {
  it("saves the maximum 255-text expansion within D1's 50-query and 100-parameter limits", async () => {
    const f = await ready(async () =>
      Response.json({
        data: Array.from({ length: 5 }, (_, root) => ({
          ...comment(String(100 + root)),
          replies: {
            data: Array.from({ length: 50 }, (_, reply) =>
              comment(String(10000 + root * 100 + reply)),
            ),
          },
        })),
      }),
    );
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      const result = await f.collector.advance(job.id);
      expect(result).toMatchObject({
        status: "completed",
        collected: 255,
        pages: 1,
        errorCode: null,
      });
      expect(prepare.mock.calls.length).toBeLessThanOrEqual(50);
      expect(prepare.mock.calls.every(([sql]) => (sql.match(/\?/g)?.length ?? 0) <= 100)).toBe(
        true,
      );
    } finally {
      prepare.mockRestore();
    }
    expect((await f.collector.status(accountId)).comments.uniqueComments).toBe(255);
    const saved = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM comments WHERE parent_id IS NOT NULL",
    ).first<{ total: number }>();
    expect(saved?.total).toBe(250);
  });
  it("saves the same 62 unique texts and parents with ten requests instead of 51 and measures payloads and D1 writes", async () => {
    let requests = 0;
    let bytes = 0;
    const roots = Array.from({ length: 50 }, (_, i) => comment(String(1000 + i)));
    const replies = (id: string) =>
      Number(id) < 1006 ? [comment(`${id}1`, id), comment(`${id}2`, id)] : [];
    const f = await ready(async (input) => {
      requests++;
      const url = new URL(String(input));
      const expanded = url.searchParams.get("fields")?.includes("replies.limit(50)");
      const offset = Number(url.searchParams.get("after") ?? 0);
      const limit = Number(url.searchParams.get("limit"));
      const isReply = url.pathname.endsWith("/replies");
      const data = isReply
        ? replies(url.pathname.split("/").at(-2) ?? "")
        : roots.slice(offset, offset + limit).map((root) => ({
            ...root,
            ...(expanded && replies(root.id).length
              ? {
                  replies: {
                    data: replies(root.id),
                    paging: { cursors: { after: "unused-tail" } },
                  },
                }
              : {}),
          }));
      const body = {
        data,
        ...(!isReply && offset + limit < roots.length
          ? {
              paging: {
                next: "https://graph.instagram.com/next",
                cursors: { after: String(offset + limit) },
              },
            }
          : {}),
      };
      const raw = JSON.stringify(body);
      bytes += new TextEncoder().encode(raw).byteLength;
      return new Response(raw);
    });
    // Count base-table writes with test-only SQLite triggers, including claims,
    // operation reservations, checkpoints and freshness rows.
    await env.DB.prepare("CREATE TABLE benchmark_writes (total INTEGER NOT NULL)").run();
    await env.DB.prepare("INSERT INTO benchmark_writes VALUES (0)").run();
    const tables = ["comments", "comment_collections", "collection_jobs", "comment_media_state"];
    for (const table of tables)
      for (const event of ["INSERT", "UPDATE"])
        await env.DB.prepare(
          `CREATE TRIGGER benchmark_${table}_${event} AFTER ${event} ON ${table} BEGIN UPDATE benchmark_writes SET total=total+1; END`,
        ).run();
    try {
      await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
        operationId: crypto.randomUUID(),
        limit: 50,
      });
      for (const root of roots)
        await f.request(`/api/media/${mediaId}/comments/collect`, "POST", {
          operationId: crypto.randomUUID(),
          parentId: root.id,
          limit: 50,
        });
      const before = await env.DB.prepare(
        "SELECT id,parent_id,text,published_at FROM comments ORDER BY id",
      ).all();
      const old = {
        requests,
        bytes,
        writes: (
          await env.DB.prepare("SELECT total FROM benchmark_writes").first<{ total: number }>()
        )?.total,
      };
      expect(old.requests).toBe(51);
      expect(old).toMatchObject({ bytes: 5208, writes: 164 });
      await f.request(`/api/media/${mediaId}/comments`, "DELETE");
      await env.DB.prepare("UPDATE benchmark_writes SET total=0").run();
      requests = 0;
      bytes = 0;
      const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
      let result = job;
      for (let step = 0; result.status === "running" && step < 12; step++)
        result = await f.collector.advance(job.id);
      expect(result).toMatchObject({
        status: "completed",
        pages: 10,
        mediaProcessed: 1,
        collected: 62,
      });
      const after = await env.DB.prepare(
        "SELECT id,parent_id,text,published_at FROM comments ORDER BY id",
      ).all();
      expect(after.results).toEqual(before.results);
      expect(requests).toBe(10);
      const measured = {
        requests,
        bytes,
        writes: (
          await env.DB.prepare("SELECT total FROM benchmark_writes").first<{ total: number }>()
        )?.total,
      };
      expect(measured.writes).toBeLessThan(old.writes ?? 0);
      expect(measured).toMatchObject({ bytes: 5851, writes: 113 });
      expect((await f.collector.status(accountId)).comments).toMatchObject({
        uniqueComments: 62,
        lastFullPassAt: f.now(),
        currentPass: null,
      });
      expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
        coverage: {
          uniqueSaved: 62,
          lastCompleteAt: f.now(),
          omittedReplyBranches: 44,
          completeHistory: false,
        },
      });
      console.log(`Comment fixture benchmark: ${JSON.stringify({ before: old, after: measured })}`);
    } finally {
      for (const table of tables)
        for (const event of ["INSERT", "UPDATE"])
          await env.DB.prepare(`DROP TRIGGER benchmark_${table}_${event}`).run();
      await env.DB.prepare("DROP TABLE benchmark_writes").run();
    }
  });

  it("continues independent long branches, empty intermediate pages and an outer continuation; after without next ends a branch", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const after = url.searchParams.get("after");
      if (url.pathname.endsWith("/comments"))
        return Response.json(
          after
            ? { data: [] }
            : {
                data: [
                  {
                    ...comment("100"),
                    replies: {
                      data: Array.from({ length: 50 }, (_, i) => comment(String(10000 + i))),
                      paging: {
                        next: "https://graph.instagram.com/next",
                        cursors: { after: "a-empty" },
                      },
                    },
                  },
                  {
                    ...comment("200"),
                    replies: {
                      data: Array.from({ length: 50 }, (_, i) => comment(String(20000 + i))),
                      paging: {
                        next: "https://graph.instagram.com/next",
                        cursors: { after: "b-last" },
                      },
                    },
                  },
                ],
                paging: {
                  next: "https://graph.instagram.com/next",
                  cursors: { after: "outer-last" },
                },
              },
        );
      if (after === "a-empty")
        return Response.json({
          data: [],
          paging: { next: "https://graph.instagram.com/next", cursors: { after: "a-last" } },
        });
      if (after === "a-last")
        return Response.json({
          data: Array.from({ length: 21 }, (_, i) => comment(String(10050 + i))),
          paging: { cursors: { after: "tail-only" } },
        });
      expect(after).toBe("b-last");
      return Response.json({ data: [comment("20050"), comment("20051")] });
    });
    const f = await ready(request);
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    expect(await f.collector.advance(job.id)).toMatchObject({
      pages: 1,
      collected: 102,
      status: "running",
    });
    let result = await f.collector.job(job.id);
    for (let i = 0; result.status === "running" && i < 8; i++)
      result = await f.collector.advance(job.id);
    expect(result).toMatchObject({ pages: 5, collected: 125, status: "completed" });
    expect(request).toHaveBeenCalledTimes(5);
    const rows = await env.DB.prepare("SELECT id,parent_id FROM comments").all<{
      id: string;
      parent_id: string | null;
    }>();
    expect(rows.results).toHaveLength(125);
    expect(rows.results.filter((row) => row.parent_id === "100")).toHaveLength(71);
    expect(rows.results.filter((row) => row.parent_id === "200")).toHaveLength(52);
  });

  it("detects a repeated non-empty page even with a different cursor, retains its texts and leaves explicit partial coverage", async () => {
    let page = 0;
    const f = await ready(async () =>
      Response.json({
        data: [comment("100")],
        paging: {
          next: "https://graph.instagram.com/next",
          cursors: { after: `cursor-${++page}` },
        },
      }),
    );
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    await f.collector.advance(job.id);
    let result = await f.collector.advance(job.id);
    expect(result).toMatchObject({
      pages: 1,
      status: "running",
      errorCode: "INSTAGRAM_PAGINATION_STALLED",
      failures: 1,
    });
    for (let i = 1; i < 5; i++) {
      f.advance(result.nextAttemptAt - f.now());
      result = await f.collector.advance(job.id);
    }
    expect(result.status).toBe("failed");
    expect((await f.collector.status(accountId)).comments).toMatchObject({
      uniqueComments: 1,
      lastFullPassAt: null,
      partialPublications: 1,
    });
    expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
      coverage: { lastCompleteAt: null, errorCode: "INSTAGRAM_PAGINATION_STALLED" },
    });
  });

  it("keeps invalid expansion, permission failures and rate limits distinct from omitted replies", async () => {
    for (const response of [
      {
        body: { data: [{ ...comment("100"), replies: {} }] },
        status: 200,
        code: "INSTAGRAM_UNAVAILABLE",
      },
      {
        body: { error: { code: 200, message: "private upstream message" } },
        status: 403,
        code: "INSTAGRAM_PERMISSION_REQUIRED",
      },
      { body: { error: { code: 4 } }, status: 429, code: "INSTAGRAM_RATE_LIMITED" },
    ]) {
      const f = await ready(async () => Response.json(response.body, { status: response.status }));
      const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
      expect(await f.collector.advance(job.id)).toMatchObject({
        collected: 0,
        pages: 0,
        errorCode: response.code,
      });
      expect((await f.collector.status(accountId)).comments.lastFullPassAt).toBeNull();
    }
  });

  it("upserts edited overlapping pages without losing older saved texts or treating new IDs as a loop", async () => {
    const f = await ready(async (input) => {
      const after = new URL(String(input)).searchParams.get("after");
      return Response.json(
        after
          ? {
              data: [{ ...comment("101"), text: "Edited" }, comment("102")],
            }
          : {
              data: [comment("100"), comment("101")],
              paging: {
                next: "https://graph.instagram.com/next",
                cursors: { after: "changed-page" },
              },
            },
      );
    });
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    await f.collector.advance(job.id);
    expect(await f.collector.advance(job.id)).toMatchObject({ status: "completed", collected: 4 });
    expect((await f.collector.status(accountId)).comments.uniqueComments).toBe(3);
    expect(await (await f.request(`/api/media/${mediaId}/comments`)).json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "100", text: "Comment 100" }),
        expect.objectContaining({ id: "101", text: "Edited" }),
        expect.objectContaining({ id: "102", text: "Comment 102" }),
      ]),
    });
  });

  it("replays an old completed page with its original size and replies mode after interruption", async () => {
    const f = await ready(async () => Response.json({ data: [] }));
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    await f.collector.advance(job.id);
    // Simulate termination after the old page was saved, before job checkpoint.
    await env.DB.prepare(
      "UPDATE collection_jobs SET status='running',pages=0,media_processed=0,collected=0,cursor=NULL,completed_at=NULL WHERE id=?",
    )
      .bind(job.id)
      .run();
    await env.DB.prepare(
      "UPDATE comment_collections SET signature=json_set(signature,'$[3]',50),result_json=json_remove(json_set(result_json,'$.limit',50),'$.expandedReplies','$.replyBranches') WHERE json_extract(result_json,'$.jobId')=?",
    )
      .bind(job.id)
      .run();
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "completed",
      pages: 1,
      errorCode: null,
    });
    expect(f.transport.comments).toHaveBeenCalledTimes(1);
  });

  it("fences a late expanded page after another worker acquires the expired lease", async () => {
    let release: ((value: Response) => void) | undefined;
    const f = await ready(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    const pending = f.collector.advance(job.id);
    for (let i = 0; !release && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(release).toBeDefined();
    f.advance(16 * 60_000);
    expect(await f.store.claim(job.id, "new-owner", f.now())).not.toBeNull();
    release?.(
      Response.json({ data: [{ ...comment("100"), replies: { data: [comment("101")] } }] }),
    );
    await pending;
    expect((await f.collector.job(job.id)).pages).toBe(0);
    expect((await f.collector.status(accountId)).comments.uniqueComments).toBe(0);
  });
});
