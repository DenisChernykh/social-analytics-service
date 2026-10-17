import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduledOperations } from "../src/app/create-features";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

const hour = 3_600_000;
const mediaId = `${accountId}_${sampleMedia.id}`;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready() {
  const f = fixture();
  await connect(f);
  vi.mocked(f.transport.mediaPage).mockResolvedValue({
    media: [{ ...sampleMedia, timestamp: f.now() }],
    nextCursor: null,
  });
  vi.mocked(f.transport.media).mockImplementation(async () => ({
    ...sampleMedia,
    timestamp: publishedAt,
  }));
  const publishedAt = f.now();
  await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
  const collector = createScheduledOperations(env, { transport: () => f.transport }, f.now);
  await collector.configure(accountId, { enabled: true, discoveryMinutes: 360 });
  await env.DB.prepare(
    "UPDATE collection_schedules SET next_stories_at=?,next_insights_at=?,next_discovery_at=?,next_catalogue_at=? WHERE account_id=?",
  )
    .bind(
      publishedAt + 1000 * hour,
      publishedAt + 1000 * hour,
      publishedAt + 1000 * hour,
      publishedAt + 1000 * hour,
      accountId,
    )
    .run();
  return { ...f, collector, store: new D1Collection(env.DB), publishedAt };
}

describe("scheduled real age snapshots (#17)", () => {
  it("collects all seven target ages without catalogue scans, duplicate targets or overwritten history", async () => {
    const f = await ready();
    const initial = await env.DB.prepare("SELECT * FROM media_snapshots").all();
    const ages = [1, 6, 24, 72, 168, 336, 720];
    for (const hours of ages) {
      f.advance(f.publishedAt + hours * hour - f.now());
      await f.collector.tick();
      await f.collector.tick();
      expect(f.transport.media).toHaveBeenCalledTimes(ages.indexOf(hours) + 1);
      expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
    }
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(1);
    const rows = await env.DB.prepare("SELECT * FROM media_snapshots ORDER BY observed_at").all();
    expect(rows.results).toHaveLength(8);
    expect(rows.results[0]).toEqual(initial.results[0]);
    expect(
      rows.results.slice(1).map((row) => (Number(row.observed_at) - f.publishedAt) / hour),
    ).toEqual(ages);
    expect((await f.collector.status(accountId)).policy.ageIntervalsHours).toEqual(ages);
  });

  it("retries a temporary failure inside the target window and preserves the actual observation time", async () => {
    const f = await ready();
    f.advance(hour);
    vi.mocked(f.transport.media).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_UNAVAILABLE", "Temporary source failure."),
    );
    await f.collector.tick();
    const failed = (await f.collector.status(accountId)).schedule;
    expect(failed.errorCode).toBe("INSTAGRAM_UNAVAILABLE");
    expect(failed.retryAt).toBe(f.now() + 5 * 60_000);
    f.advance(5 * 60_000);
    await f.collector.tick();
    expect((await f.collector.status(accountId)).schedule.errorCode).toBeNull();
    expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
    const snapshot = await env.DB.prepare(
      "SELECT MAX(observed_at) AS time FROM media_snapshots",
    ).first<{ time: number }>();
    expect(snapshot?.time).toBe(f.now());
    expect(snapshot?.time).not.toBe(f.publishedAt + hour);
  });

  it("uses existing snapshots in the tolerance window, skips missed ages and prioritizes targets over old lifetime refresh", async () => {
    const f = await ready();
    f.advance(23 * hour);
    expect(
      (
        await f.request(`/api/media/${mediaId}/refresh`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    f.advance(hour);
    expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
    f.advance(48 * hour);
    expect(await f.store.dueAgeMedia(accountId, f.now())).toMatchObject({
      mediaId,
      targetHours: 72,
    });
    await f.collector.tick();
    const snapshots = await env.DB.prepare(
      "SELECT observed_at FROM media_snapshots ORDER BY observed_at",
    ).all<{ observed_at: number }>();
    expect(snapshots.results.map((row) => (row.observed_at - f.publishedAt) / hour)).toEqual([
      0, 23, 72,
    ]);
    f.advance(1000 * hour);
    expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
  });

  it("leaves collection opt-in and isolates accounts and Stories", async () => {
    const f = await ready();
    f.advance(hour);
    expect(await f.store.dueAgeMedia("another-account", f.now())).toBeNull();
    await f.collector.configure(accountId, { enabled: false, discoveryMinutes: 360 });
    await f.collector.tick();
    expect(f.transport.media).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE media SET product_type='STORY'").run();
    expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
  });

  it("gives due age targets priority over stale lifetime media and supplies five real observations to content analysis", async () => {
    const f = await ready();
    await env.DB.batch(
      Array.from({ length: 5 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES (?,?,?,'','', 'VIDEO','REELS',?,?,?)",
        ).bind(
          `${accountId}_peer${i}`,
          accountId,
          `peer${i}`,
          `https://www.instagram.com/reel/peer${i}/`,
          i === 4 ? f.publishedAt - 1000 * hour : f.publishedAt,
          f.now(),
        ),
      ),
    );
    vi.mocked(f.transport.media).mockImplementation(async (_token, id) => ({
      ...sampleMedia,
      id,
      timestamp: f.publishedAt,
    }));
    f.advance(168 * hour);
    for (let i = 0; i < 5; i++) {
      await f.collector.tick();
      f.advance(5 * 60_000);
    }
    expect(vi.mocked(f.transport.media).mock.calls.map((call) => call[1])).not.toContain("peer4");
    const response = await f.request(
      `/api/accounts/${accountId}/content-analysis?ageDays=7&metric=views&timeZone=UTC`,
    );
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      coverage: { observed: number; missing: number };
      groups: { dimension: string; enoughData: boolean; sampleSize: number }[];
    };
    expect(report.coverage).toMatchObject({ observed: 5, missing: 0 });
    expect(report.groups.find((group) => group.dimension === "localHour")).toMatchObject({
      enoughData: true,
      sampleSize: 5,
    });
  });

  it("retains rate-limit backoff and never fills an expired age window with a late observation", async () => {
    const f = await ready();
    f.advance(hour);
    vi.mocked(f.transport.media).mockRejectedValueOnce(
      new ApplicationError("INSTAGRAM_RATE_LIMITED", "Source rate limit."),
    );
    await f.collector.tick();
    expect((await f.collector.status(accountId)).schedule.retryAt).toBe(f.now() + 15 * 60_000);
    f.advance(31 * 60_000);
    expect(await f.store.dueAgeMedia(accountId, f.now())).toBeNull();
    await f.collector.tick();
    const history = await env.DB.prepare("SELECT observed_at FROM media_snapshots").all<{
      observed_at: number;
    }>();
    expect(history.results.some((row) => row.observed_at === f.publishedAt + hour)).toBe(false);
  });
});
