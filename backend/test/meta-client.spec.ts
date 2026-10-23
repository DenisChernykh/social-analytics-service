import { describe, expect, it, vi } from "vitest";
import { MetaClient } from "../src/modules/instagram/infrastructure/meta-client";

const config = {
  clientId: "test-instagram-client",
  clientSecret: "test-client-secret",
  redirectUri: "https://backend.example/api/instagram/oauth/callback",
  apiVersion: "v26.0",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("official Meta API adapter", () => {
  it("discovers Stories with a bounded list and resumes each pending ID after recreating the client", async () => {
    const item = (id: string) => ({
      id,
      media_type: "IMAGE",
      permalink: `https://www.instagram.com/stories/test/${id}/`,
      timestamp: "2026-10-23T06:00:00Z",
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: [item("11"), item("22"), item("33")],
          paging: {
            cursors: { after: "source-next" },
            next: "https://untrusted.example/?access_token=hidden",
          },
        }),
      )
      .mockResolvedValueOnce(json(item("22")))
      .mockResolvedValueOnce(json(item("33")))
      .mockResolvedValueOnce(json({ data: [] }));
    const first = await new MetaClient(config, request).stories("fake-token", "123", null, 1);
    expect(first.media.map((m) => m.id)).toEqual(["11"]);
    expect(new URL(String(request.mock.calls[0]?.[0])).searchParams.get("limit")).toBe("50");
    const second = await new MetaClient(config, request).stories(
      "fake-token",
      "123",
      first.nextCursor,
      1,
    );
    expect(second.media.map((m) => m.id)).toEqual(["22"]);
    const third = await new MetaClient(config, request).stories(
      "fake-token",
      "123",
      second.nextCursor,
      1,
    );
    expect(third.media.map((m) => m.id)).toEqual(["33"]);
    expect(third.nextCursor).toBe("source-next");
    expect(
      await new MetaClient(config, request).stories("fake-token", "123", third.nextCursor, 1),
    ).toEqual({ media: [], nextCursor: null });
    expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/v26.0/123/stories",
      "/v26.0/22",
      "/v26.0/33",
      "/v26.0/123/stories",
    ]);
    expect(new URL(String(request.mock.calls[3]?.[0])).searchParams.get("after")).toBe(
      "source-next",
    );
    expect(JSON.stringify([first.nextCursor, second.nextCursor])).not.toContain("hidden");
    expect(first.nextCursor?.length).toBeLessThan(4096);
  });

  it("avoids a false single-Story continuation when the source advertises next only for limit=1", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      json({
        data: [
          {
            id: "11",
            media_type: "IMAGE",
            permalink: "https://www.instagram.com/stories/test/11/",
            timestamp: "2026-10-23T06:00:00Z",
          },
        ],
        ...(new URL(String(url)).searchParams.get("limit") === "1"
          ? { paging: { next: "https://graph.instagram.com/next", cursors: { after: "same" } } }
          : {}),
      }),
    );
    expect(
      await new MetaClient(config, request).stories("fake-token", "123", null, 1),
    ).toMatchObject({ media: [{ id: "11", productType: "STORY" }], nextCursor: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated source cursors and cross-account pending Stories without fetching extra objects", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        data: [],
        paging: { next: "https://untrusted.example/", cursors: { after: "same" } },
      }),
    );
    const client = new MetaClient(config, request);
    await expect(client.stories("fake-token", "123", "same", 1)).rejects.toMatchObject({
      code: "INSTAGRAM_PAGINATION_STALLED",
    });
    const cursor = `stories:v1:${btoa(JSON.stringify({ userId: "999", pending: ["11"], after: null }))}`;
    await expect(client.stories("fake-token", "123", cursor, 1)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("distinguishes Story viewer thresholds from missing permissions without probing every metric", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            error: { code: 10, message: "(#10) Not enough viewers for the media to show insights" },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(json({ error: { code: 10, message: "Permission required" } }, 400));
    const client = new MetaClient(config, request);
    expect(await client.insights("fake-token", "123", ["views", "reach", "replies"])).toEqual({
      views: { value: null, reason: "insufficient_audience" },
      reach: { value: null, reason: "insufficient_audience" },
      replies: { value: null, reason: "insufficient_audience" },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      await client.structuredInsights("fake-token", "123", {
        metric: "navigation",
        period: "lifetime",
        metricType: "total_value",
        breakdown: "story_navigation_action_type",
      }),
    ).toMatchObject({ value: null, reason: "permission_required" });
  });
  it("preserves unavailable demographic categories and untimed lifetime Story values without inventing daily points", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: [
            {
              name: "engaged_audience_demographics",
              period: "lifetime",
              total_value: { breakdowns: [{ dimension_keys: ["age"] }] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              name: "navigation",
              period: "lifetime",
              values: [{ value: 10 }],
              total_value: {
                value: 10,
                breakdowns: [
                  {
                    dimension_keys: ["story_navigation_action_type"],
                    results: [{ dimension_values: ["tap_back"], value: 0 }],
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({ data: [{ name: "reach", period: "day", values: [{ value: 10 }] }] }),
      );
    const client = new MetaClient(config, request);
    expect(
      await client.structuredInsights("fake-token", "123", {
        metric: "engaged_audience_demographics",
        period: "lifetime",
        metricType: "total_value",
        timeframe: "last_30_days",
        breakdown: "age",
      }),
    ).toMatchObject({
      value: null,
      reason: "not_returned",
      breakdowns: [{ dimensions: ["age"], results: [] }],
      points: [],
    });
    expect(
      await client.structuredInsights("fake-token", "123", {
        metric: "navigation",
        period: "lifetime",
        metricType: "total_value",
        breakdown: "story_navigation_action_type",
      }),
    ).toMatchObject({
      value: 10,
      reason: null,
      points: [],
      breakdowns: [{ results: [{ categories: ["tap_back"], value: 0, reason: null }] }],
    });
    await expect(
      client.structuredInsights("fake-token", "123", {
        metric: "reach",
        period: "day",
        metricType: "time_series",
      }),
    ).rejects.toMatchObject({ code: "INSTAGRAM_UNAVAILABLE" });
  });
  it("requests comment permission only for an explicitly chosen reconnect", () => {
    const client = new MetaClient(config);
    expect(new URL(client.authorizationUrl("fake-state")).searchParams.get("scope")).not.toContain(
      "manage_comments",
    );
    expect(
      new URL(client.authorizationUrl("fake-state", true)).searchParams.get("scope"),
    ).toContain("instagram_business_manage_comments");
  });
  it("parses structured totals, categories and real time series without summing unique reach", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: [
            {
              name: "reach",
              period: "day",
              total_value: {
                value: 10,
                breakdowns: [
                  {
                    dimension_keys: ["media_product_type"],
                    results: [
                      { dimension_values: ["REELS"], value: 8 },
                      { dimension_values: ["FEED"], value: 7 },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              name: "reach",
              period: "day",
              values: [
                { value: 8, end_time: "2026-10-01T00:00:00Z" },
                { value: 7, end_time: "2026-10-02T00:00:00Z" },
              ],
            },
          ],
        }),
      );
    const client = new MetaClient(config, request);
    const total = await client.structuredInsights("fake-token", "123", {
      metric: "reach",
      period: "day",
      metricType: "total_value",
      since: 1790812800000,
      until: 1790899200000,
      breakdown: "media_product_type",
    });
    expect(total.value).toBe(10);
    expect(total.breakdowns[0]?.results.map((item) => item.value)).toEqual([8, 7]);
    const series = await client.structuredInsights("fake-token", "123", {
      metric: "reach",
      period: "day",
      metricType: "time_series",
    });
    expect(series.value).toBeNull();
    expect(series.points.map((point) => point.value)).toEqual([8, 7]);
    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.hostname).toBe("graph.instagram.com");
    expect(url.searchParams.get("since")).toBe("1790812800");
    expect(url.searchParams.has("access_token")).toBe(false);
  });
  it("keeps rejected combinations distinct from transport failures and invalid numeric values", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { code: 100 } }, 400))
      .mockResolvedValueOnce(json({ error: { code: 4 } }, 429))
      .mockResolvedValueOnce(json({ data: [{ name: "views", total_value: { value: -1 } }] }));
    const client = new MetaClient(config, request);
    const query = { metric: "views", period: "day" as const, metricType: "total_value" as const };
    await expect(client.structuredInsights("fake-token", "123", query)).rejects.toMatchObject({
      code: "INSTAGRAM_SOURCE_ERROR",
    });
    await expect(client.structuredInsights("fake-token", "123", query)).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
    });
    expect(await client.structuredInsights("fake-token", "123", query)).toMatchObject({
      value: null,
      reason: "invalid_value",
    });
  });
  it("reads Story discovery and comment replies on fixed hosts with cursor-only pagination", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(
        json({
          data: [{ id: "456", text: "Question?", timestamp: "2026-10-01T00:00:00Z" }],
          paging: {
            next: "https://invalid.example/?access_token=fake",
            cursors: { after: "next" },
          },
        }),
      );
    const client = new MetaClient(config, request);
    expect(await client.stories("fake-token", "123", null, 1)).toEqual({
      media: [],
      nextCursor: null,
    });
    expect(new URL(String(request.mock.calls[0]?.[0])).pathname).toBe("/v26.0/123/stories");
    expect(await client.comments("fake-token", "123", true, "before", 25)).toMatchObject({
      items: [{ id: "456", text: "Question?", parentId: "123" }],
      nextCursor: "next",
    });
    const url = new URL(String(request.mock.calls[1]?.[0]));
    expect(url.pathname).toBe("/v26.0/123/replies");
    expect(url.searchParams.get("fields")).toBe(
      "id,text,timestamp,parent_id,from,username,like_count,hidden",
    );
    expect(url.searchParams.get("after")).toBe("before");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("preserves parent IDs when the media comments edge includes replies in its flat list", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        data: [
          { id: "111", text: "Question?", timestamp: "2026-10-01T00:00:00Z" },
          {
            id: "222",
            text: "Answer",
            timestamp: "2026-10-01T00:01:00Z",
            parent_id: "111",
          },
        ],
      }),
    );
    const client = new MetaClient(config, request);
    expect(await client.comments("fake-token", "123", false, null, 50)).toMatchObject({
      items: [
        { id: "111", parentId: null },
        { id: "222", parentId: "111" },
      ],
      nextCursor: null,
    });
    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v26.0/123/comments");
    expect(url.searchParams.get("fields")).toBe(
      "id,text,timestamp,parent_id,from,username,like_count,hidden",
    );
  });
  it("reports Meta's minimum-audience response as missing demographic data without inventing zeros", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { code: 3006, message: "Not enough users" } }, 400));
    const client = new MetaClient(config, request);
    expect(
      await client.structuredInsights("fake-token", "123", {
        metric: "engaged_audience_demographics",
        period: "lifetime",
        metricType: "total_value",
        timeframe: "this_week",
        breakdown: "country",
      }),
    ).toMatchObject({ value: null, reason: "insufficient_audience", breakdowns: [] });
  });
  it("preserves the global receiver required by a native Worker fetch", async () => {
    const request = vi.fn<typeof fetch>(async function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return json({
        access_token: "test-token",
        permissions: ["instagram_business_basic", "instagram_business_manage_insights"],
      });
    });
    const result = await new MetaClient(config, request).exchangeCode("test-code");
    expect(result.accessToken).toBe("test-token");
  });

  it("uses Instagram Login and accepts the documented nested token response", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json({
        data: [
          {
            access_token: "test-token",
            user_id: "123",
            permissions: "instagram_business_basic,instagram_business_manage_insights",
          },
        ],
      }),
    );
    const client = new MetaClient(config, request);
    const authorization = new URL(client.authorizationUrl("test-state"));
    expect(authorization.origin).toBe("https://www.instagram.com");
    expect(authorization.searchParams.get("client_id")).toBe(config.clientId);
    expect(authorization.searchParams.get("scope")).toContain("instagram_business_manage_insights");
    expect(authorization.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    const result = await client.exchangeCode("test-code");
    expect(result.scopes).toContain("instagram_business_manage_insights");
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.instagram.com/oauth/access_token");
    expect(init?.method).toBe("POST");
    const form = init?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("code")).toBe("test-code");
    expect(init?.redirect).toBe("manual");
    const nativeRequest = new Request(String(url), init);
    expect(nativeRequest.redirect).toBe("manual");
  });

  it("rejects redirects without following their destination or exposing credentials", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response("", {
          status: 302,
          headers: { Location: "https://untrusted.example/?access_token=test-token" },
        }),
    );
    await expect(new MetaClient(config, request).profile("test-token")).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
      message: "Instagram returned an unexpected redirect; no credentials were forwarded.",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0] ?? [];
    expect(new Request(String(input), init).redirect).toBe("manual");
  });

  it("uses only a cursor on the fixed Graph host and rejects incomplete pagination", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json({
        data: [],
        paging: {
          cursors: { after: "next-cursor" },
          next: "https://untrusted.example/?access_token=do-not-follow",
        },
      }),
    );
    const client = new MetaClient(config, request);
    expect(await client.mediaPage("test-token", "123", "previous-cursor", 3)).toEqual({
      media: [],
      nextCursor: "next-cursor",
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(new URL(String(url)).origin).toBe("https://graph.instagram.com");
    expect(new URL(String(url)).searchParams.get("after")).toBe("previous-cursor");
    expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce(
      json({ data: [], paging: { next: "https://untrusted.example/" } }),
    );
    await expect(client.mediaPage("test-token", "123", null, 3)).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
    });
  });

  it("keeps the supported insights when Meta rejects a grouped metric", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          { error: { code: 100, message: "does not support the metrics: facebook_views." } },
          400,
        ),
      )
      .mockResolvedValueOnce(json({ data: [{ name: "views", values: [{ value: 0 }] }] }))
      .mockResolvedValueOnce(json({ error: { code: 100 } }, 400));
    const result = await new MetaClient(config, request).insights("test-token", "123", [
      "views",
      "facebook_views",
    ]);
    expect(result.views).toEqual({ value: 0, reason: null });
    expect(result.facebook_views).toEqual({ value: null, reason: "not_supported" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("accepts total_value, keeps empty data null and does not sum multiple time buckets", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json({
        data: [
          { name: "views", total_value: { value: 321 } },
          { name: "reach", values: [{ value: 100 }, { value: 200 }] },
          { name: "saved", values: [{ value: -1 }] },
          { name: "reels_skip_rate", values: [{ value: 23.5 }] },
        ],
      }),
    );
    const result = await new MetaClient(config, request).insights("test-token", "123", [
      "views",
      "reach",
      "saved",
      "shares",
      "reels_skip_rate",
    ]);
    expect(result.views?.value).toBe(321);
    expect(result.reach?.value).toBeNull();
    expect(result.saved).toEqual({ value: null, reason: "invalid_value" });
    expect(result.shares).toEqual({ value: null, reason: "not_returned" });
    expect(result.reels_skip_rate?.value).toBe(23.5);
  });

  it("retains Instagram metrics when crossposting insights return their known unavailable error", async () => {
    const unavailable = {
      error: { code: -1, error_subcode: 2207086, is_transient: false, message: "Fatal" },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(unavailable, 400))
      .mockResolvedValueOnce(json(unavailable, 400))
      .mockResolvedValueOnce(json(unavailable, 400))
      .mockResolvedValueOnce(json({ data: [{ name: "views", values: [{ value: 222 }] }] }));
    const client = new MetaClient(config, request);
    const result = await client.insights("test-token", "123", [
      "views",
      "facebook_views",
      "crossposted_views",
    ]);
    expect(result.views).toEqual({ value: 222, reason: null });
    expect(result.facebook_views).toEqual({ value: null, reason: "not_supported" });
    expect(result.crossposted_views).toEqual({ value: null, reason: "not_supported" });
    expect(request).toHaveBeenCalledTimes(4);
    request.mockResolvedValueOnce(
      json({ error: { code: -1, error_subcode: 999, is_transient: false } }, 400),
    );
    await expect(client.insights("test-token", "123", ["views"])).rejects.toMatchObject({
      code: "INSTAGRAM_SOURCE_ERROR",
      message: "Meta rejected insights (HTTP 400, code -1).",
    });
    request.mockResolvedValueOnce(
      json({ error: { code: -1, error_subcode: 2207086, is_transient: true } }, 400),
    );
    await expect(client.insights("test-token", "123", ["views"])).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
    });
  });

  it("retries supported groups after an explicit rejected metric and confirms crossposting separately", async () => {
    const unavailable = {
      error: { code: -1, error_subcode: 2207086, is_transient: false },
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: 100,
              message:
                "Instagram Insights Media API endpoint does not support the metrics: reposts. Please refer to documentation.",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(json(unavailable, 400))
      .mockResolvedValueOnce(json(unavailable, 400))
      .mockResolvedValueOnce(
        json({ data: [{ name: "crossposted_views", values: [{ value: 9 }] }] }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            { name: "views", values: [{ value: 222 }] },
            { name: "reach", values: [{ value: 207 }] },
          ],
        }),
      );
    const result = await new MetaClient(config, request).insights("test-token", "123", [
      "views",
      "reach",
      "reposts",
      "facebook_views",
      "crossposted_views",
    ]);
    expect(result.views).toEqual({ value: 222, reason: null });
    expect(result.reach).toEqual({ value: 207, reason: null });
    expect(result.reposts).toEqual({ value: null, reason: "not_supported" });
    expect(result.facebook_views).toEqual({ value: null, reason: "not_supported" });
    expect(result.crossposted_views).toEqual({ value: 9, reason: null });
    expect(request).toHaveBeenCalledTimes(5);
    expect(new URL(String(request.mock.calls[4]?.[0])).searchParams.get("metric")).toBe(
      "views,reach",
    );
  });

  it("exposes safe rate-limit and auth errors without upstream secrets", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { code: 4, message: "test-token is limited" } }, 400))
      .mockResolvedValueOnce(
        json({ error_type: "OAuthException", code: 190, error_message: "test-token expired" }, 400),
      )
      .mockRejectedValueOnce(new Error("https://upstream.example/?access_token=test-token"))
      .mockResolvedValueOnce(
        json({ error: { code: 777, message: "access_token=test-token" } }, 400),
      );
    const client = new MetaClient(config, request);
    await expect(client.insights("test-token", "123", ["views"])).rejects.toMatchObject({
      code: "INSTAGRAM_RATE_LIMITED",
      message: "Instagram rate limit reached; retry later.",
    });
    await expect(client.profile("test-token")).rejects.toMatchObject({
      code: "INSTAGRAM_AUTH_EXPIRED",
      message: "Reconnect Instagram; Meta rejected the access token.",
    });
    await expect(client.profile("test-token")).rejects.toMatchObject({
      code: "INSTAGRAM_UNAVAILABLE",
      message: "Instagram could not be reached during profile; retry the request later.",
    });
    await expect(client.profile("test-token")).rejects.toMatchObject({
      code: "INSTAGRAM_SOURCE_ERROR",
      message: "Meta rejected profile (HTTP 400, code 777).",
    });
  });

  it("marks permission-restricted insights as unavailable", async () => {
    const request = vi.fn<typeof fetch>(async () => json({ error: { code: 10 } }, 403));
    expect(
      await new MetaClient(config, request).insights("test-token", "123", ["views", "reach"]),
    ).toEqual({
      views: { value: null, reason: "permission_required" },
      reach: { value: null, reason: "permission_required" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
