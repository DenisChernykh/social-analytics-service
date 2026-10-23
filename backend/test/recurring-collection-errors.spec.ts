import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionExecutor } from "../src/app/create-features";
import { ageSnapshotWindows } from "../src/modules/collection/domain/age-policy";
import { ageCoverage } from "../src/modules/collection/domain/coverage";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { ApplicationError } from "../src/shared/application/application-error";
import { nextObjectFailureDelay } from "../src/shared/domain/source-failure";
import { accountId, connect, fixture, sampleMedia } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});

async function ready() {
  const f = fixture();
  await connect(f);
  return {
    ...f,
    collector: createCollectionExecutor(env, { transport: () => f.transport }, f.now),
  };
}

describe("recurring collection failures", () => {
  it("reads all job pages without recomputing account diagnostics or requesting Instagram", async () => {
    const f = await ready();
    for (let i = 0; i < 3; i++) {
      await f.collector.start(accountId, crypto.randomUUID(), "audience");
      f.advance(1);
    }
    const methods = [
      "coverage",
      "diagnostics",
      "dataFreshness",
      "mediaRefreshStatus",
      "commentStatus",
    ] as const;
    const spies = methods.map((method) => vi.spyOn(D1Collection.prototype, method));
    try {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const result = await f.request(
          `/api/accounts/${accountId}/collection/jobs?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        expect(result.status).toBe(200);
        const page = (await result.json()) as {
          jobs: { id: string }[];
          jobsPage: { nextCursor: string | null; total: number };
        };
        expect(Object.keys(page).sort()).toEqual(["jobs", "jobsPage"]);
        expect(page.jobsPage.total).toBe(3);
        ids.push(...page.jobs.map((job) => job.id));
        cursor = page.jobsPage.nextCursor;
      } while (cursor);
      expect(new Set(ids).size).toBe(3);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(f.transport.profile).toHaveBeenCalledTimes(1); // OAuth connection only.
      expect(f.transport.insights).not.toHaveBeenCalled();
      expect(
        (await f.request(`/api/accounts/${accountId}/collection/jobs`, "GET", undefined, false))
          .status,
      ).toBe(401);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("stops repeated Stories before duplicate metrics and observations, preserving the failed cursor", async () => {
    const f = await ready();
    const story = { ...sampleMedia, productType: "STORY" };
    vi.mocked(f.transport.stories).mockResolvedValue({ media: [story], nextCursor: "loop" });
    const job = await f.collector.start(accountId, crypto.randomUUID(), "stories", true);
    await f.collector.advance(job.id);
    const requests = vi.mocked(f.transport.insights).mock.calls.length;
    expect(await f.collector.advance(job.id)).toMatchObject({
      status: "failed",
      pages: 1,
      cursor: "loop",
      errorCode: "INSTAGRAM_PAGINATION_STALLED",
      effectiveState: "incomplete",
    });
    expect(f.transport.insights).toHaveBeenCalledTimes(requests);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM media_snapshots").first("n")).toBe(1);
    await f.collector.advance(job.id);
    expect(f.transport.insights).toHaveBeenCalledTimes(requests);
  });

  it("backs off repeated object insight refusals and resets the delay after a successful observation", async () => {
    const f = await ready();
    const original = vi.mocked(f.transport.insights).getMockImplementation();
    const refuse = () =>
      vi
        .mocked(f.transport.insights)
        .mockRejectedValue(
          new ApplicationError("INSTAGRAM_SOURCE_ERROR", "Object insight refusal"),
        );
    refuse();
    const mediaId = `${accountId}_${sampleMedia.id}`;
    for (const delay of [300_000, 600_000, 1_200_000]) {
      const result = await f.request(`/api/accounts/${accountId}/sync`, "POST", {
        operationId: crypto.randomUUID(),
      });
      expect(result.status).toBe(200);
      const row = await env.DB.prepare(
        "SELECT unavailable_until until,unavailable_code code FROM media WHERE id=?",
      )
        .bind(mediaId)
        .first();
      expect(row).toEqual({ until: f.now() + delay, code: "INSTAGRAM_SOURCE_ERROR" });
      f.advance(1000);
      expect(
        (await f.request(`/api/media/${mediaId}`, "PATCH", { title: "Updated title" })).status,
      ).toBe(200);
      f.advance(delay - 1000 + 1);
    }
    if (!original) throw new Error("Missing source fixture");
    vi.mocked(f.transport.insights).mockImplementation(original);
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT unavailable_until FROM media WHERE id=?")
        .bind(mediaId)
        .first("unavailable_until"),
    ).toBe(0);
    refuse();
    f.advance(1);
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT unavailable_until FROM media WHERE id=?")
        .bind(mediaId)
        .first("unavailable_until"),
    ).toBe(f.now() + 300_000);
    const latest = await env.DB.prepare(
      "SELECT metrics_json FROM media_snapshots WHERE media_id=? ORDER BY observed_at DESC LIMIT 1",
    )
      .bind(mediaId)
      .first<string>("metrics_json");
    expect(JSON.parse(latest ?? "{}").reach).toMatchObject({ value: null, reason: "source_error" });
  });

  it("caps repeated object delays, honors a longer source Retry-After, and resets when the error changes", () => {
    const previous = { errorCode: "INSTAGRAM_SOURCE_ERROR", retryDelayMs: 64_000_000 };
    expect(nextObjectFailureDelay("INSTAGRAM_SOURCE_ERROR", 300_000, previous)).toBe(86_400_000);
    expect(nextObjectFailureDelay("INSTAGRAM_SOURCE_ERROR", 2 * 86_400_000, previous)).toBe(
      2 * 86_400_000,
    );
    expect(nextObjectFailureDelay("INSTAGRAM_INVALID_REQUEST", 3_600_000, previous)).toBe(
      3_600_000,
    );
  });

  it("keeps age coverage equal to the full-history calculation at boundaries, with real zero reach and null observations", async () => {
    const f = await ready();
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const publishedAt = f.now() - 35 * 86_400_000;
    const mediaId = `${accountId}_${sampleMedia.id}`;
    await env.DB.prepare("UPDATE media SET published_at=? WHERE id=?")
      .bind(publishedAt, mediaId)
      .run();
    let n = 0;
    for (const { targetHours, toleranceHours } of ageSnapshotWindows) {
      const target = publishedAt + targetHours * 3_600_000;
      const start = target - toleranceHours * 3_600_000;
      const end = target + toleranceHours * 3_600_000;
      for (const [at, value] of [
        [start - 1, 10],
        [start, null],
        [target, 0],
        [end, 15],
        [end + 1, 100],
      ] as const) {
        await env.DB.prepare(
          "INSERT INTO media_snapshots(id,media_id,observed_at,api_version,metrics_json) VALUES(?,?,?,?,?)",
        )
          .bind(`boundary-${n++}`, mediaId, at, "v26.0", JSON.stringify({ reach: { value } }))
          .run();
      }
    }
    const observations = (
      await env.DB.prepare(
        "SELECT media_id mediaId,observed_at observedAt,json_extract(metrics_json,'$.reach.value') IS NOT NULL usable FROM media_snapshots",
      ).all<{ mediaId: string; observedAt: number; usable: boolean }>()
    ).results;
    const connectedAt = await env.DB.prepare("SELECT connected_at FROM accounts WHERE id=?")
      .bind(accountId)
      .first<number>("connected_at");
    const result = await new D1Collection(env.DB).coverage(accountId, f.now());
    expect(result.analysisCoverage).toEqual(
      ageSnapshotWindows.map((window) => ({
        ...ageCoverage(
          [
            {
              id: mediaId,
              publishedAt,
              productType: sampleMedia.productType,
              connectedAt: connectedAt ?? 0,
            },
          ],
          observations,
          [],
          f.now(),
          window.targetHours,
          window.toleranceHours,
        ),
        metric: "reach",
        rankingMode: "absolute",
      })),
    );
  });

  it("retains useful zeroes in unknown metric fields and Story navigation after the JSON fast path", async () => {
    const f = await ready();
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const mediaId = `${accountId}_${sampleMedia.id}`;
    await env.DB.prepare("UPDATE media_snapshots SET metrics_json=?,observed_at=? WHERE media_id=?")
      .bind(
        JSON.stringify({ reach: { value: null }, futureMetric: { value: 0 } }),
        f.now() - 1000,
        mediaId,
      )
      .run();
    const store = new D1Collection(env.DB);
    expect((await store.dataFreshness(accountId))[0]?.lastUsefulObservation).toBe(f.now() - 1000);
    await env.DB.prepare(
      "UPDATE media_snapshots SET metrics_json=?,story_insights_json=?,observed_at=? WHERE media_id=?",
    )
      .bind(
        JSON.stringify({ reach: { value: null } }),
        JSON.stringify({ navigation: { unknownAction: { value: 0 } } }),
        f.now(),
        mediaId,
      )
      .run();
    expect((await store.dataFreshness(accountId))[0]?.lastUsefulObservation).toBe(f.now());
  });
});
