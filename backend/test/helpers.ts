import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { createCollectionExecutor } from "../src/app/create-features";
import type { InstagramTransport } from "../src/modules/instagram/application/ports";
import type { InstagramMedia } from "../src/modules/instagram/public-contracts";

export const testKey = "local-test-key-at-least-thirty-two-characters";
export const accountId = "ig_17841490000000001";
export const sampleMedia: InstagramMedia = {
  id: "17900000000000001",
  caption: "Кино-курьер — вечер в кино",
  mediaType: "VIDEO",
  productType: "REELS",
  permalink: "https://www.instagram.com/reel/test-reel/",
  timestamp: 1_790_000_000_000,
  likeCount: 100,
  commentsCount: 10,
};

export function fixture() {
  let now = 1_790_999_000_000;
  const profile = {
    userId: "17841490000000001",
    username: "test_creator",
    accountType: "MEDIA_CREATOR",
    followersCount: 1000,
    mediaCount: 1,
  };
  const values: Record<string, number> = {
    views: 2000,
    reach: 1000,
    likes: 100,
    comments: 10,
    saved: 20,
    shares: 5,
    reposts: 3,
    total_interactions: 135,
    ig_reels_avg_watch_time: 15000,
    ig_reels_video_view_total_time: 30000000,
    reels_skip_rate: 25,
  };
  const transport: InstagramTransport = {
    subscribeComments: vi.fn(async () => {}),
    authorizationUrl: (state) => `https://www.instagram.com/oauth/authorize?state=${state}`,
    exchangeCode: vi.fn(async () => ({
      accessToken: "fake-short-token",
      scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    })),
    extendToken: vi.fn(async () => ({ accessToken: "fake-long-token", expiresIn: 60 * 86400 })),
    refreshToken: vi.fn(async () => ({
      accessToken: "fake-refreshed-token",
      expiresIn: 60 * 86400,
    })),
    profile: vi.fn(async () => profile),
    mediaPage: vi.fn(async () => ({ media: [sampleMedia], nextCursor: null })),
    media: vi.fn(async () => sampleMedia),
    stories: vi.fn(async () => ({ media: [], nextCursor: null })),
    structuredInsights: vi.fn(async (_token, _id, query) => ({
      metric: query.metric,
      period: query.period,
      metricType: query.metricType,
      value: null,
      reason: "not_returned" as const,
      description: null,
      points: [],
      breakdowns: [],
    })),
    comments: vi.fn(async () => ({ items: [], nextCursor: null })),
    insights: vi.fn(async (_token: string, _id: string, fields: string[]) =>
      Object.fromEntries(
        fields.map((field) => [
          field,
          {
            value: values[field] ?? null,
            reason: values[field] === undefined ? ("not_returned" as const) : null,
          },
        ]),
      ),
    ),
  };
  const app = createApp({
    instagram: { transport: () => transport },
    clock: () => now,
    collectionCommands: (bindings) =>
      createCollectionExecutor(bindings, { transport: () => transport }, () => now),
  });
  const request = (path: string, method = "GET", body?: unknown, authenticated = true) =>
    app.request(
      path,
      {
        method,
        headers: {
          ...(authenticated ? { Authorization: `Bearer ${testKey}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  return {
    app,
    request,
    transport,
    values,
    profile,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

export async function connect(f: ReturnType<typeof fixture>) {
  const start = await f.request("/api/instagram/oauth/start", "POST");
  const body = (await start.json()) as { authorizationUrl: string };
  const state = new URL(body.authorizationUrl).searchParams.get("state");
  const result = await f.request(
    `/api/instagram/oauth/callback?${new URLSearchParams({ state: state ?? "", code: "fake-code" })}`,
    "GET",
    undefined,
    false,
  );
  if (result.status !== 200) throw new Error(`Test connection failed: ${result.status}`);
  return result;
}
