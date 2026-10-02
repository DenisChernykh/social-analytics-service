import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1Analytics } from "../src/modules/analytics/infrastructure/d1-analytics";
import { reportSchema } from "../src/modules/analytics/presentation/schemas";
import { TokenCipher } from "../src/platform/crypto/secrets";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia, testKey } from "./helpers";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM oauth_attempts"),
  ]);
});

describe("personal API and OAuth", () => {
  it("protects statistics, publishes OpenAPI and rejects malformed input without exposing query values", async () => {
    const f = fixture();
    expect((await f.request("/health", "GET", undefined, false)).status).toBe(200);
    expect((await f.request("/api/accounts", "GET", undefined, false)).status).toBe(401);
    const spec = (await (await f.request("/openapi.json", "GET", undefined, false)).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/reports/media"]).toBeDefined();
    const response = await f.request("/api/media?limit=secret-value");
    const body = (await response.json()) as { instance: string; code: string };
    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.instance).not.toContain("secret-value");
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(
      (await f.request("/api/media?from=2026-10-02T00:00:00Z&to=2026-01-01T00:00:00Z")).status,
    ).toBe(400);
    expect((await f.request("/api/media?cursor=invalid-base64")).status).toBe(400);
    expect(
      (
        await f.request(
          `/api/media?${new URLSearchParams({ q: Array.from({ length: 41 }, (_, i) => `w${i}`).join(" ") })}`,
        )
      ).status,
    ).toBe(400);
    const invalidJson = await f.app.request(
      `/api/accounts/${accountId}/sync`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/json" },
        body: "{",
      },
      env,
    );
    expect(invalidJson.status).toBe(400);
    expect((await f.request(`/api/accounts/${accountId}/sync`, "POST")).status).toBe(415);
  });

  it("uses a hashed single-use state, encrypts tokens and never returns credentials", async () => {
    const f = fixture();
    const start = (await (await f.request("/api/instagram/oauth/start", "POST")).json()) as {
      authorizationUrl: string;
    };
    const state = new URL(start.authorizationUrl).searchParams.get("state") as string;
    const stored = await env.DB.prepare("SELECT state_hash FROM oauth_attempts").first<{
      state_hash: string;
    }>();
    expect(stored?.state_hash).not.toBe(state);
    const result = await f.request(
      `/api/instagram/oauth/callback?state=${state}&code=fake-code`,
      "GET",
      undefined,
      false,
    );
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain("fake-long-token");
    expect(
      (
        await f.request(
          `/api/instagram/oauth/callback?state=${state}&code=fake-code`,
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(400);
    const connection = await env.DB.prepare(
      "SELECT encrypted_token FROM instagram_connections",
    ).first<{ encrypted_token: string }>();
    expect(connection?.encrypted_token).not.toContain("fake-long-token");
    expect(
      await new TokenCipher(env.TOKEN_ENCRYPTION_KEY as string).decrypt(
        connection?.encrypted_token ?? "",
        accountId,
      ),
    ).toBe("fake-long-token");
    await expect(
      new TokenCipher(env.TOKEN_ENCRYPTION_KEY as string).decrypt(
        connection?.encrypted_token ?? "",
        "another-account",
      ),
    ).rejects.toMatchObject({ code: "INSTAGRAM_AUTH_EXPIRED" });
    expect(await (await f.request("/api/instagram/connections")).text()).not.toContain("token");
  });

  it("rejects expired and denied authorization without calling the token exchange", async () => {
    const f = fixture();
    const start = (await (await f.request("/api/instagram/oauth/start", "POST")).json()) as {
      authorizationUrl: string;
    };
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    f.advance(11 * 60000);
    expect(
      (
        await f.request(
          `/api/instagram/oauth/callback?state=${state}&code=fake-code`,
          "GET",
          undefined,
          false,
        )
      ).status,
    ).toBe(400);
    expect(f.transport.exchangeCode).not.toHaveBeenCalled();
    const second = (await (await f.request("/api/instagram/oauth/start", "POST")).json()) as {
      authorizationUrl: string;
    };
    const denied = await f.request(
      `/api/instagram/oauth/callback?state=${new URL(second.authorizationUrl).searchParams.get("state")}&error=access_denied`,
      "GET",
      undefined,
      false,
    );
    expect(((await denied.json()) as { code: string }).code).toBe("OAUTH_DENIED");
    expect(f.transport.exchangeCode).not.toHaveBeenCalled();
  });
});

describe("collection, search and analytics", () => {
  it("keeps zero counts and counter corrections distinct from unavailable growth", async () => {
    const f = fixture();
    await connect(f);
    f.values.views = 0;
    f.values.reach = 0;
    const sync = () =>
      f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId: crypto.randomUUID() });
    expect((await sync()).status).toBe(200);
    const id = `${accountId}_${sampleMedia.id}`;
    await f.request(`/api/media/${id}`, "PATCH", { durationSeconds: 5 });
    f.advance(3_600_000);
    f.values.views = 10;
    expect((await sync()).status).toBe(200);
    const report = reportSchema.parse(
      await (await f.request(`/api/media/${id}/statistics`)).json(),
    );
    expect(report.metrics?.reach.value).toBe(0);
    expect(report.calculated?.engagementByReach.reason).toBe("zero_denominator");
    expect(report.calculated?.averageWatchRatio.value).toBe(300);
    expect(report.growth.gain.value).toBe(10);
    expect(report.growth.percent.reason).toBe("zero_denominator");
    f.advance(3_600_000);
    f.values.views = 5;
    expect((await sync()).status).toBe(200);
    const corrected = reportSchema.parse(
      await (await f.request(`/api/media/${id}/statistics`)).json(),
    );
    expect(corrected.growth.netChange).toBe(-5);
    expect(corrected.growth.perHour.value).toBeNull();
    expect(corrected.growth.perHour.reason).toBe("counter_decreased");
  });

  it("refuses to collect a token belonging to another account", async () => {
    const f = fixture();
    await connect(f);
    vi.mocked(f.transport.profile).mockResolvedValue({ ...f.profile, userId: "another-user" });
    const response = await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(f.transport.mediaPage).not.toHaveBeenCalled();
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first<{ n: number }>())?.n,
    ).toBe(0);
  });

  it("collects idempotently, resolves a Russian title and calculates traceable metrics and growth", async () => {
    const f = fixture();
    await connect(f);
    const operationId = crypto.randomUUID();
    const sync = () => f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId });
    expect((await sync()).status).toBe(200);
    expect((await sync()).status).toBe(200);
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(1);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first<{ n: number }>())?.n,
    ).toBe(1);
    expect(
      (await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId, pageSize: 1 }))
        .status,
    ).toBe(409);
    const resolved = (await (
      await f.request(`/api/reports/media?${new URLSearchParams({ query: "КИНО курьер" })}`)
    ).json()) as { status: string; report: unknown };
    expect(resolved.status).toBe("matched");
    const first = reportSchema.parse(resolved.report);
    expect(first.metrics?.views.value).toBe(2000);
    expect(first.calculated?.engagementByReach.value).toBe(13.5);
    expect(first.calculated?.averageWatchRatio.reason).toBe("missing_inputs");
    expect(first.growth.gain.reason).toBe("no_baseline");
    const id = `${accountId}_${sampleMedia.id}`;
    await f.request(`/api/media/${id}`, "PATCH", { title: "Кино курьер", durationSeconds: 30 });
    f.advance(3_600_000);
    f.values.views = 2500;
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const second = reportSchema.parse(
      await (await f.request(`/api/media/${id}/statistics`)).json(),
    );
    expect(second.media.title).toBe("Кино курьер");
    expect(second.calculated?.averageWatchRatio.value).toBe(50);
    expect(second.growth.perHour.value).toBe(500);
    expect(second.growth.percent.value).toBe(25);
    const summary = (await (await f.request(`/api/accounts/${accountId}/summary`)).json()) as {
      totals: { views: { value: number } };
    };
    expect(summary.totals.views.value).toBe(2500);
  });

  it("preserves missing metrics, avoids ambiguous selection and does not call an unknown completion rate retention", async () => {
    const f = fixture();
    await connect(f);
    vi.mocked(f.transport.mediaPage).mockResolvedValue({
      media: [
        sampleMedia,
        { ...sampleMedia, id: "17900000000000002", caption: "Ещё один кино курьер" },
      ],
      nextCursor: "next-page",
    });
    delete f.values.views;
    delete f.values.total_interactions;
    delete f.values.saved;
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const resolved = (await (
      await f.request(`/api/reports/media?${new URLSearchParams({ query: "Кино курьер" })}`)
    ).json()) as { status: string; report: unknown; candidates: unknown[] };
    expect(resolved.status).toBe("ambiguous");
    expect(resolved.report).toBeNull();
    expect(resolved.candidates).toHaveLength(2);
    const report = reportSchema.parse(
      await (await f.request(`/api/media/${accountId}_${sampleMedia.id}/statistics`)).json(),
    );
    expect(report.metrics?.views).toMatchObject({ value: null, reason: "not_returned" });
    expect(report.calculated?.engagementByReach.value).toBeNull();
    const summary = (await (await f.request(`/api/accounts/${accountId}/summary`)).json()) as {
      totals: { views: { value: number | null; available: number } };
    };
    expect(summary.totals.views.value).toBeNull();
    expect(summary.totals.views.available).toBe(0);
  });

  it("resolves long Unicode titles permitted by the API contract", async () => {
    const f = fixture();
    await connect(f);
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const title = "Сверхдлинноеназваниепубликациибезпробелов".repeat(3);
    const id = `${accountId}_${sampleMedia.id}`;
    expect((await f.request(`/api/media/${id}`, "PATCH", { title })).status).toBe(200);
    const response = await f.request(
      `/api/reports/media?${new URLSearchParams({ query: title.toUpperCase() })}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "matched",
      report: { media: { id, title } },
    });
  });

  it("does not partially commit a failed page and retains the safe sync outcome", async () => {
    const f = fixture();
    await connect(f);
    vi.mocked(f.transport.mediaPage).mockResolvedValue({
      media: [sampleMedia, { ...sampleMedia, id: "17900000000000002" }],
      nextCursor: null,
    });
    vi.mocked(f.transport.insights)
      .mockResolvedValueOnce({ views: { value: 123, reason: null } })
      .mockRejectedValueOnce(
        new ApplicationError("INSTAGRAM_RATE_LIMITED", "Instagram rate limit reached."),
      );
    const operationId = crypto.randomUUID();
    const response = await f.request(`/api/accounts/${accountId}/sync`, "POST", { operationId });
    expect(response.status).toBe(429);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM media").first<{ n: number }>())?.n,
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first<{ n: number }>())?.n,
    ).toBe(0);
    expect(await (await f.request(`/api/sync-runs/${operationId}`)).json()).toMatchObject({
      status: "failed",
      errorCode: "INSTAGRAM_RATE_LIMITED",
    });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_leases").first<{ n: number }>())?.n,
    ).toBe(0);
  });

  it("paginates tied publication timestamps without skipping media and preserves manual names", async () => {
    const f = fixture();
    await connect(f);
    vi.mocked(f.transport.mediaPage).mockResolvedValue({
      media: [
        sampleMedia,
        { ...sampleMedia, id: "17900000000000002" },
        { ...sampleMedia, id: "17900000000000003" },
      ],
      nextCursor: null,
    });
    await f.request(`/api/accounts/${accountId}/sync`, "POST", {
      operationId: crypto.randomUUID(),
    });
    const seen = [];
    let cursor: string | null = null;
    do {
      const page = (await (
        await f.request(
          `/api/media?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        )
      ).json()) as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(3);
    const id = `${accountId}_${sampleMedia.id}`;
    await f.request(`/api/media/${id}`, "PATCH", { title: "Ёлка" });
    expect(
      (
        (await (await f.request(`/api/media?${new URLSearchParams({ q: "елка" })}`)).json()) as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
  });

  it("blocks concurrent syncs and fences expired collectors from committing", async () => {
    const f = fixture();
    await connect(f);
    const repository = new D1Analytics(env.DB);
    const first = {
      id: crypto.randomUUID(),
      accountId,
      inputCursor: null,
      pageSize: 3,
      status: "running" as const,
      startedAt: f.now(),
      completedAt: null,
      nextCursor: null,
      mediaCount: 0,
      errorCode: null,
    };
    expect(await repository.begin(first, f.now() + 1000)).toBe(true);
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    f.advance(2000);
    const second = { ...first, id: crypto.randomUUID(), startedAt: f.now() };
    expect(await repository.begin(second, f.now() + 1000)).toBe(true);
    await expect(
      repository.finish(
        { ...first, status: "completed", completedAt: f.now() },
        f.profile,
        [],
        f.now(),
      ),
    ).rejects.toMatchObject({ code: "SYNC_IN_PROGRESS" });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM account_snapshots").first<{ n: number }>())
        ?.n,
    ).toBe(0);
    expect(
      (await env.DB.prepare("SELECT run_id FROM sync_leases").first<{ run_id: string }>())?.run_id,
    ).toBe(second.id);
  });

  it("refreshes a near-expiry token once per sync and retains history when disconnected", async () => {
    const f = fixture();
    await connect(f);
    await env.DB.prepare("UPDATE instagram_connections SET expires_at=?,refreshed_at=?")
      .bind(f.now() + 2 * 86400000, f.now() - 2 * 86400000)
      .run();
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(f.transport.refreshToken).toHaveBeenCalledTimes(1);
    expect((await f.request(`/api/instagram/connections/${accountId}`, "DELETE")).status).toBe(204);
    expect((await f.request(`/api/media/${accountId}_${sampleMedia.id}/statistics`)).status).toBe(
      200,
    );
    expect(
      (
        await f.request(`/api/accounts/${accountId}/sync`, "POST", {
          operationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
  });
});
