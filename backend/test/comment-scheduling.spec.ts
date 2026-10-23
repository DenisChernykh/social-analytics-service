import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

const hour = 3_600_000;
const cron = 5 * 60_000;
const mediaId = `${accountId}_${sampleMedia.id}`;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready() {
  const f = fixture();
  f.advance(Math.ceil(f.now() / (2 * cron)) * 2 * cron - f.now());
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
  const collector = createCollectionExecutor(env, { transport: () => f.transport }, f.now);
  await collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
  return { ...f, collector, store: new D1Collection(env.DB) };
}

describe("comment freshness, full reconciliation and fairness (#18)", () => {
  it("serves overdue Stories and discovery while age observations have pending work", async () => {
    const f = await ready();
    const startedAt = f.now();
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(startedAt - hour, mediaId)
      .run();
    await env.DB.batch(
      Array.from({ length: 20 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES (?,?,?,'','', 'VIDEO','REELS',?,?,?)",
        ).bind(
          `${accountId}_age-${index}`,
          accountId,
          String(19000000000000001n + BigInt(index)),
          `https://www.instagram.com/reel/age-${index}/`,
          startedAt - hour,
          startedAt,
        ),
      ),
    );
    vi.mocked(f.transport.mediaPage).mockResolvedValue({
      media: [{ ...sampleMedia, timestamp: startedAt - hour }],
      nextCursor: null,
    });
    await env.DB.prepare("DELETE FROM media_snapshots").run();
    await env.DB.prepare(
      "UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=?,next_insights_at=?",
    )
      .bind(f.now() - hour, f.now() - hour, f.now() + 1000 * hour)
      .run();
    expect(await f.store.dueAgeMedia(accountId, f.now())).toMatchObject({ targetHours: 1 });
    for (let slot = 0; slot < 6; slot++) {
      if (slot) f.advance(cron);
      await f.collector.tick();
    }
    expect((await f.collector.status(accountId)).jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "stories", status: "completed" }),
        expect.objectContaining({ origin: "scheduled", status: "completed" }),
      ]),
    );
    expect(f.transport.stories).toHaveBeenCalledTimes(1);
    expect(await f.store.dueAgeMedia(accountId, f.now())).not.toBeNull();
  });
  it("rechecks an enabled schedule after five failures while honoring its retry time", async () => {
    const f = await ready();
    await env.DB.prepare("UPDATE media_snapshots SET observed_at=observed_at-8*86400000").run();
    await env.DB.prepare("UPDATE instagram_connections SET scopes=? WHERE account_id=?")
      .bind(
        JSON.stringify(["instagram_business_basic", "instagram_business_manage_insights"]),
        accountId,
      )
      .run();
    await env.DB.prepare(
      "UPDATE collection_schedules SET failures=5,error_code='INSTAGRAM_UNAVAILABLE',retry_at=?,next_stories_at=?,next_discovery_at=?,next_insights_at=?",
    )
      .bind(
        f.now() + 15 * 60_000,
        f.now() + 1000 * hour,
        f.now() + 1000 * hour,
        f.now() + 1000 * hour,
      )
      .run();
    await f.collector.tick();
    expect(f.transport.media).not.toHaveBeenCalled();
    f.advance(15 * 60_000);
    await f.collector.tick();
    expect(f.transport.media).toHaveBeenCalledTimes(1);
    expect((await f.collector.status(accountId)).schedule).toMatchObject({
      enabled: true,
      failures: 0,
      errorCode: null,
    });
  });
  it("updates a recent publication during a 236-publication legacy backfill while Stories, insights, discovery and lifetime refresh progress with one step per tick", async () => {
    const f = await ready();
    const startedAt = f.now();
    const freshId = `${accountId}_19000000000000001`;
    await env.DB.batch([
      env.DB.prepare("UPDATE media SET published_at=? WHERE id=?").bind(
        startedAt - 1000 * hour,
        mediaId,
      ),
      ...Array.from({ length: 235 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES (?,?,?,'','', 'VIDEO','REELS',?,?,?)",
        ).bind(
          i === 0 ? freshId : `${accountId}_${19000000000000001n + BigInt(i)}`,
          accountId,
          String(19000000000000001n + BigInt(i)),
          `https://www.instagram.com/reel/fixture-${i}/`,
          startedAt - (i === 0 ? 10 : 1000 + i) * hour,
          startedAt,
        ),
      ),
    ]);
    vi.mocked(f.transport.comments).mockImplementation(async (_token, objectId, replies) => ({
      items:
        !replies && objectId === "19000000000000001"
          ? [{ id: "900", text: "Fresh text", publishedAt: startedAt - hour }]
          : [],
      nextCursor: null,
      ...(!replies ? { replyBranches: [] } : {}),
    }));
    vi.mocked(f.transport.media).mockImplementation(async (_token, id) => ({
      ...sampleMedia,
      id,
      timestamp: startedAt - (id === "19000000000000001" ? 10 : 1000) * hour,
    }));
    const backfill = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    // Persist the old, unversioned cursor rather than restarting the catalogue.
    await env.DB.prepare(
      "UPDATE collection_jobs SET cursor=?,pages=1119,media_processed=155,collected=2070 WHERE id=?",
    )
      .bind(
        JSON.stringify({
          afterMedia: null,
          current: { id: mediaId, publishedAt: startedAt - 1000 * hour },
          commentCursor: "legacy-outer",
          parents: [],
          replyCursor: null,
        }),
        backfill.id,
      )
      .run();
    let firstFreshAt: number | undefined;
    for (let slot = 0; slot < 144; slot++) {
      const before = (await f.collector.status(accountId)).jobs.reduce(
        (sum, job) => sum + job.pages,
        0,
      );
      const sourceBefore = [
        f.transport.comments,
        f.transport.media,
        f.transport.mediaPage,
        f.transport.stories,
      ].reduce((sum, mock) => sum + vi.mocked(mock).mock.calls.length, 0);
      await f.collector.tick();
      const status = await f.collector.status(accountId);
      expect(status.jobs.reduce((sum, job) => sum + job.pages, 0) - before).toBeLessThanOrEqual(1);
      const sourceAfter = [
        f.transport.comments,
        f.transport.media,
        f.transport.mediaPage,
        f.transport.stories,
      ].reduce((sum, mock) => sum + vi.mocked(mock).mock.calls.length, 0);
      expect(sourceAfter - sourceBefore).toBeLessThanOrEqual(1);
      if (
        !firstFreshAt &&
        (await env.DB.prepare("SELECT 1 FROM comments WHERE media_id=?").bind(freshId).first())
      )
        firstFreshAt = f.now();
      f.advance(cron);
    }
    const status = await f.collector.status(accountId);
    expect(firstFreshAt).toBeDefined();
    expect((firstFreshAt ?? Infinity) - startedAt).toBeLessThanOrEqual(2 * hour);
    expect(await f.collector.job(backfill.id)).toMatchObject({
      status: "running",
      errorCode: null,
    });
    expect((await f.collector.job(backfill.id)).mediaProcessed).toBeGreaterThan(155);
    expect(f.transport.stories).toHaveBeenCalled();
    expect(f.transport.structuredInsights).toHaveBeenCalled();
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(3); // Initial sync + two discoveries.
    expect(f.transport.media).toHaveBeenCalled();
    expect(
      status.jobs.some((job) => job.origin === "comments_refresh" && job.status === "completed"),
    ).toBe(true);
    expect(status.comments.uniqueComments).toBe(1);
  }, 30_000);

  it("uses the documented intervals even with an unchanged counter and prioritizes webhook and counter signals", async () => {
    const f = await ready();
    await env.DB.prepare(
      "INSERT INTO comment_media_state (media_id,last_complete_at,next_refresh_at,last_comments_count) VALUES (?,?,?,10)",
    )
      .bind(mediaId, f.now(), f.now() + hour)
      .run();
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toBeNull();
    f.advance(hour);
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toMatchObject({ id: mediaId });
    await env.DB.prepare("UPDATE comment_media_state SET next_refresh_at=?")
      .bind(f.now() + 168 * hour)
      .run();
    await env.DB.prepare(
      "UPDATE media_snapshots SET metrics_json=json_set(metrics_json,'$.comments.value',11)",
    ).run();
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toMatchObject({ id: mediaId });
    await env.DB.prepare(
      "UPDATE media_snapshots SET metrics_json=json_set(metrics_json,'$.comments.value',10)",
    ).run();
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toBeNull();
    await f.collector.receiveCommentEvent(
      accountId,
      sampleMedia.id,
      "signed-event-identity",
      f.now(),
    );
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toMatchObject({ id: mediaId });
    expect(await f.store.nextCommentRefresh("another-account", f.now())).toBeNull();
    await env.DB.prepare("UPDATE media SET product_type='STORY'").run();
    expect(await f.store.nextCommentRefresh(accountId, f.now())).toBeNull();
  });

  it("keeps a completed full pass for 30 days instead of creating another every daily insights refresh", async () => {
    const f = await ready();
    const previous = await f.collector.start(accountId, crypto.randomUUID(), "comments", true);
    await env.DB.prepare("UPDATE collection_jobs SET status='completed',completed_at=? WHERE id=?")
      .bind(f.now() - 29 * 24 * hour, previous.id)
      .run();
    await env.DB.prepare("UPDATE collection_schedules SET next_stories_at=?,next_discovery_at=?")
      .bind(f.now() + 1000 * hour, f.now() + 1000 * hour)
      .run();
    await f.collector.tick();
    expect(
      (await f.collector.status(accountId)).jobs.filter((job) => job.origin === "comments"),
    ).toHaveLength(1);
    f.advance(2 * 24 * hour);
    // Expiring calendar obligations may precede the daily replan. It must still
    // run within six bounded slots rather than assume a particular first action.
    for (let i = 0; i < 6; i++) {
      await f.collector.tick();
      if ((await f.store.jobs(accountId)).filter((j) => j.origin === "comments").length === 2)
        break;
      f.advance(cron);
    }
    const jobs = (await f.collector.status(accountId)).jobs.filter(
      (job) => job.origin === "comments",
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.some((job) => job.status === "running")).toBe(true);
  });
});
