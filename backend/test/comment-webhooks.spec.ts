import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledOperations } from "../src/app/create-features";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

const mediaId = `${accountId}_${sampleMedia.id}`;
const verifyToken = "test-only-webhook-verification-token-over-32-characters";
const path = "/webhooks/instagram/comments";
const event = (time = 1_790_999_000, id = "111") => {
  const notification = {
    id: "17841490000000001",
    time,
    field: "comments",
    value: {
      id,
      text: "Untrusted notification",
      from: { username: "must-not-persist" },
      media: { id: sampleMedia.id },
    },
  };
  return { object: "instagram", entry: [notification] as [typeof notification] };
};

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function sign(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-client-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${[...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function ready(comments = true) {
  const f = fixture();
  vi.mocked(f.transport.exchangeCode).mockResolvedValue({
    accessToken: "fake-token",
    scopes: [
      "instagram_business_basic",
      "instagram_business_manage_insights",
      ...(comments ? ["instagram_business_manage_comments"] : []),
    ],
  });
  await connect(f);
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  const post = async (payload: unknown, signature?: string) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return f.app.request(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature ?? (await sign(body)),
        },
        body,
      },
      env,
    );
  };
  return {
    ...f,
    post,
    collector: createScheduledOperations(env, { transport: () => f.transport }, f.now),
    store: new D1Collection(env.DB),
  };
}

describe("signed minimal comment notifications (#18)", () => {
  it("accepts a 100-event batch within the D1 query limit and deduplicates identical replay", async () => {
    const f = await ready();
    const batch = {
      object: "instagram",
      entry: Array.from(
        { length: 100 },
        (_, i) => event(1_790_999_000 + i, String(1000 + i)).entry[0],
      ),
    };
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      expect((await f.post(batch)).status).toBe(200);
      expect((await f.post(batch)).status).toBe(200);
      expect(prepare.mock.calls.length).toBeLessThanOrEqual(50);
    } finally {
      prepare.mockRestore();
    }
    expect(await f.store.commentGeneration(mediaId)).toBe(100);
    const records = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM comment_webhook_events",
    ).first<{ total: number }>();
    expect(records?.total).toBe(100);
    expect((await f.collector.status(accountId)).comments.webhook.lastEventAt).toBe(
      (1_790_999_000 + 99) * 1000,
    );
    expect(
      (await f.post({ object: "instagram", entry: [...batch.entry, batch.entry[0]] })).status,
    ).toBe(400);
    expect(await f.store.commentGeneration(mediaId)).toBe(100);
  });
  it("verifies the callback without a personal API key and never reflects a rejected verify token", async () => {
    const f = await ready();
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "12345",
    });
    const response = await f.app.request(`${path}?${query}`, undefined, {
      ...env,
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: verifyToken,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
    query.set("hub.verify_token", "wrong-private-value");
    const rejected = await f.app.request(`${path}?${query}`, undefined, {
      ...env,
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: verifyToken,
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).not.toContain("wrong-private-value");
  });

  it("checks the signature over original bytes, rejects invalid input before writes and marks due without storing text or a fabricated timestamp", async () => {
    const f = await ready();
    const body = JSON.stringify(event(), null, 2);
    expect((await f.post(body, "sha256=invalid")).status).toBe(403);
    expect((await f.post(`${body} `, await sign(body))).status).toBe(403);
    expect((await f.post("{}")).status).toBe(400);
    expect((await f.post(body)).status).toBe(200);
    const state = await env.DB.prepare("SELECT * FROM comment_media_state WHERE media_id=?")
      .bind(mediaId)
      .first();
    expect(state).toMatchObject({
      event_generation: 1,
      processed_generation: 0,
      last_complete_at: null,
      last_webhook_at: f.now(),
    });
    expect((await f.collector.status(accountId)).comments).toMatchObject({
      uniqueComments: 0,
      webhook: { active: false, lastReceivedAt: f.now() },
    });
    const saved = await env.DB.prepare("SELECT * FROM comment_webhook_events").all();
    expect(JSON.stringify(saved.results)).not.toContain("Untrusted notification");
    expect(JSON.stringify(saved.results)).not.toContain("must-not-persist");
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toMatchObject({ id: mediaId });
  });

  it("deduplicates changes and direct-entry payloads, preserves newer event time across reordered deliveries and requires explicit subscription", async () => {
    const f = await ready();
    const initial = event();
    expect((await f.post(initial)).status).toBe(200);
    const item = initial.entry[0];
    expect(
      (
        await f.post({
          object: "instagram",
          entry: [
            { id: item.id, time: item.time, changes: [{ field: item.field, value: item.value }] },
          ],
        })
      ).status,
    ).toBe(200);
    expect(await f.store.commentGeneration(mediaId)).toBe(1);
    await f.post(event(item.time - 10, "112"));
    expect(await f.store.commentGeneration(mediaId)).toBe(2);
    expect((await f.collector.status(accountId)).comments.webhook.lastEventAt).toBe(
      item.time * 1000,
    );
    expect(f.transport.subscribeComments).not.toHaveBeenCalled();
    expect(
      (await f.request(`/api/accounts/${accountId}/comments/webhook/subscribe`, "POST", {})).status,
    ).toBe(200);
    expect(f.transport.subscribeComments).toHaveBeenCalledTimes(1);
    expect((await f.collector.status(accountId)).comments.webhook.active).toBe(true);
  });

  it("ignores unconnected accounts, revoked permission and known publications belonging to another account", async () => {
    const f = await ready(false);
    await f.post(event());
    expect(await f.store.commentGeneration(mediaId)).toBe(0);
    await env.DB.prepare("UPDATE instagram_connections SET scopes=? WHERE account_id=?")
      .bind(JSON.stringify(["instagram_business_manage_comments"]), accountId)
      .run();
    const foreign = event();
    foreign.entry[0].id = "999";
    await f.post(foreign);
    await env.DB.prepare(
      "INSERT INTO accounts (id,platform,external_id,username,account_type,connected_at) VALUES ('ig_other','instagram','999','other','MEDIA_CREATOR',0)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES ('foreign','ig_other','999999','','','VIDEO','REELS','https://www.instagram.com/reel/foreign/',0,0)",
    ).run();
    const wrongMedia = event();
    wrongMedia.entry[0].value.media.id = "999999";
    await f.post(wrongMedia);
    expect((await f.collector.status(accountId)).comments.webhook.lastReceivedAt).toBeNull();
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS total FROM comment_webhook_events").first<{
          total: number;
        }>()
      )?.total,
    ).toBe(0);
  });

  it("keeps an event arriving during collection dirty until a later reconciliation and retains opt-in scheduling", async () => {
    const f = await ready();
    let release: (() => void) | undefined;
    vi.mocked(f.transport.comments).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [], nextCursor: null, replyBranches: [] });
        }),
    );
    const job = await f.collector.start(accountId, crypto.randomUUID(), "comments");
    const pending = f.collector.advance(job.id);
    for (let i = 0; !release && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(release).toBeDefined();
    await f.post(event());
    release?.();
    await pending;
    const state = await env.DB.prepare(
      "SELECT event_generation,processed_generation FROM comment_media_state WHERE media_id=?",
    )
      .bind(mediaId)
      .first();
    expect(state).toEqual({ event_generation: 1, processed_generation: 0 });
    expect(await f.store.nextCommentRefresh(accountId, f.now())).not.toBeNull();
    expect((await f.collector.status(accountId)).schedule.enabled).toBe(false);
    vi.mocked(f.transport.comments).mockResolvedValue({
      items: [],
      nextCursor: null,
      replyBranches: [],
    });
    const reconcile = await f.collector.start(
      accountId,
      crypto.randomUUID(),
      "comments_refresh",
      true,
      { id: mediaId, publishedAt: sampleMedia.timestamp },
    );
    await f.collector.advance(reconcile.id);
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toBeNull();
  });

  it("requests discovery of unknown media without treating notification time as publishedAt", async () => {
    const f = await ready();
    await f.collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
    await env.DB.prepare("UPDATE collection_schedules SET next_discovery_at=? WHERE account_id=?")
      .bind(f.now() + 86_400_000, accountId)
      .run();
    const unknown = event();
    unknown.entry[0].value.media.id = "888888";
    await f.post(unknown);
    expect((await f.collector.status(accountId)).schedule.nextDiscoveryAt).toBe(f.now());
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM media").first<{ total: number }>())
        ?.total,
    ).toBe(1);
  });
});
