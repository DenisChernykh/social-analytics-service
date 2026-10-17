import type { InstagramMedia } from "../src/modules/instagram/public-contracts";

export type CollectionCase = {
  name: string;
  productType: "REELS" | "FEED" | "STORY";
  mediaCount?: number;
  maxAttempts: number;
  rejectMetadata?: boolean;
  unsupported?: string[];
  sourceError?: string[];
  rejectCore?: string[];
  denyProfileActivity?: boolean;
  failCoreOnce?: boolean;
  coreQuotaPercent?: number;
  invalidAdditional?: string;
  malformedAdditional?: boolean;
  values?: Record<string, number | null>;
};

export const collectionCases: CollectionCase[] = [
  { name: "reels_supported", productType: "REELS", maxAttempts: 6 },
  { name: "feed_supported", productType: "FEED", maxAttempts: 6 },
  { name: "story_supported", productType: "STORY", maxAttempts: 6 },
  {
    name: "reels_optional_rejected",
    productType: "REELS",
    maxAttempts: 6,
    rejectMetadata: true,
    unsupported: ["facebook_views"],
  },
  {
    name: "feed_restrictions",
    productType: "FEED",
    maxAttempts: 6,
    unsupported: ["facebook_views"],
    rejectCore: ["follows", "profile_visits"],
    denyProfileActivity: true,
  },
  {
    name: "story_restrictions",
    productType: "STORY",
    maxAttempts: 6,
    unsupported: ["facebook_views"],
    rejectCore: ["follows", "profile_visits"],
    denyProfileActivity: true,
  },
  {
    name: "partial_source_error",
    productType: "REELS",
    maxAttempts: 6,
    unsupported: ["facebook_views"],
    sourceError: ["crossposted_views"],
  },
  {
    name: "page_budget_exhausted",
    productType: "REELS",
    mediaCount: 2,
    maxAttempts: 6,
    unsupported: ["facebook_views"],
  },
  { name: "retry_after_failure", productType: "REELS", maxAttempts: 6, failCoreOnce: true },
  {
    name: "zero_missing",
    productType: "REELS",
    maxAttempts: 6,
    values: {
      views: 0,
      saved: 0,
      shares: null,
      ig_reels_video_view_total_time: 0,
      ig_reels_avg_watch_time: null,
      reels_skip_rate: 0,
      facebook_views: 0,
      crossposted_views: 0,
    },
  },
  {
    name: "zero_denominator_deferred",
    productType: "REELS",
    maxAttempts: 3,
    values: { views: 0, reach: 0, saved: 0, shares: 0 },
  },
  { name: "pre_insights_budget", productType: "REELS", maxAttempts: 2 },
];

export const phase1AccountId = "ig_17841490000000001";
export const phase1OperationId = "00000000-0000-4000-8000-000000000701";
export const phase1ApiKey = "local-phase1-fixture-key-at-least-thirty-two-characters";
export const phase1EncryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export const phase1Profile = {
  userId: "17841490000000001",
  username: "phase1_fixture",
  accountType: "MEDIA_CREATOR",
  followersCount: 1000,
  mediaCount: 2,
};

export function collectionFixture(scenario: CollectionCase) {
  let now = 1_791_516_800_000;
  let failedCore = false;
  const calls: { family: string; objectId: string; fields: string[]; startedAt: number }[] = [];
  const values: Record<string, number | null> = {
    views: 2000,
    reach: 1000,
    likes: 100,
    comments: 10,
    saved: 20,
    shares: 5,
    reposts: 3,
    total_interactions: 135,
    ig_reels_video_view_total_time: 30_000_000,
    ig_reels_avg_watch_time: 15_000,
    reels_skip_rate: 25,
    facebook_views: 80,
    crossposted_views: 2080,
    follows: 2,
    profile_visits: 3,
    replies: 0,
    ...scenario.values,
  };
  const media: InstagramMedia[] = Array.from({ length: scenario.mediaCount ?? 1 }, (_, index) => ({
    id: `17900000000001${String(index).padStart(3, "0")}`,
    caption: `phase1 fixture ${index}`,
    mediaType: scenario.productType === "REELS" ? "VIDEO" : "IMAGE",
    productType: scenario.productType,
    permalink: `https://www.instagram.com/${scenario.productType === "REELS" ? "reel" : "p"}/phase1-${index}/`,
    timestamp: now - 7 * 86_400_000,
    likeCount: values.likes ?? null,
    commentsCount: values.comments ?? null,
  }));
  const json = (body: unknown, status = 200, quotaPercent = 12) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "facebook-api-version": "v26.0",
        "x-app-usage": JSON.stringify({
          call_count: quotaPercent,
          total_time: 3,
          total_cputime: 4,
        }),
      },
    });
  const rawMedia = (item: InstagramMedia) => ({
    id: item.id,
    caption: item.caption,
    media_type: item.mediaType,
    media_product_type: item.productType,
    permalink: item.permalink,
    timestamp: new Date(item.timestamp).toISOString(),
    like_count: item.likeCount,
    comments_count: item.commentsCount,
  });
  const http: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://graph.instagram.com") throw new Error("Unexpected fixture origin");
    const objectId = url.pathname.split("/")[2] ?? "";
    const fields = url.searchParams.get("metric")?.split(",") ?? [];
    const family = url.pathname.endsWith("/insights")
      ? url.searchParams.has("metric_type")
        ? "structured"
        : "scalar"
      : url.pathname.endsWith("/me")
        ? "profile"
        : "catalog";
    calls.push({ family, objectId, fields, startedAt: now });
    now += 2000;
    if (family === "profile")
      return json({
        user_id: phase1Profile.userId,
        username: phase1Profile.username,
        account_type: phase1Profile.accountType,
        followers_count: phase1Profile.followersCount,
        media_count: media.length,
      });
    if (family === "catalog") {
      if (scenario.rejectMetadata && url.searchParams.get("fields")?.includes("alt_text"))
        return json(
          { error: { code: 100, message: "Tried accessing nonexisting field (alt_text)" } },
          400,
        );
      if (objectId === phase1Profile.userId)
        return json({
          data: media.map(rawMedia),
          paging: {
            cursors: { after: "phase1-next" },
            next: "https://graph.instagram.com/fixture",
          },
        });
      const item = media.find((item) => item.id === objectId);
      if (!item) throw new Error("Unknown fixture object");
      return json(rawMedia(item));
    }
    if (family === "structured") {
      if (fields[0] === "profile_activity" && scenario.denyProfileActivity)
        return json({ error: { code: 200, message: "Fixture permission required" } }, 403);
      const navigation = fields[0] === "navigation";
      return json({
        data: [
          {
            name: fields[0],
            period: "lifetime",
            total_value: {
              value: navigation ? 18 : 5,
              breakdowns: [
                {
                  dimension_keys: [navigation ? "story_navigation_action_type" : "action_type"],
                  results: (navigation
                    ? [
                        ["tap_forward", 10],
                        ["tap_back", 3],
                        ["tap_exit", 2],
                        ["swipe_forward", 3],
                      ]
                    : [
                        ["profile_visit", 3],
                        ["follow", 2],
                      ]
                  ).map(([category, value]) => ({ dimension_values: [category], value })),
                },
              ],
            },
          },
        ],
      });
    }
    if (scenario.failCoreOnce && !failedCore && fields.includes("reach")) {
      failedCore = true;
      return json(
        { error: { code: 2, is_transient: true, message: "Fixture temporary failure" } },
        503,
      );
    }
    if (fields.some((field) => scenario.unsupported?.includes(field)))
      return json({ error: { code: -1, error_subcode: 2207086, is_transient: false } }, 400);
    if (fields.some((field) => scenario.sourceError?.includes(field)))
      return json(
        { error: { code: 2, is_transient: true, message: "Fixture partial failure" } },
        503,
      );
    if (scenario.invalidAdditional && fields.includes(scenario.invalidAdditional))
      return json({ error: { code: 100, message: "Invalid parameter for this metric" } }, 400);
    if (
      scenario.malformedAdditional &&
      fields.every((field) => ["facebook_views", "crossposted_views"].includes(field))
    )
      return json({ data: null });
    const rejected = fields.filter((field) => scenario.rejectCore?.includes(field));
    if (rejected.length)
      return json(
        { error: { code: 100, message: `does not support the metrics: ${rejected.join(", ")}.` } },
        400,
      );
    return json(
      { data: fields.map((name) => ({ name, values: [{ value: values[name] ?? null }] })) },
      200,
      fields.includes("reach") ? scenario.coreQuotaPercent : 12,
    );
  };
  return {
    http,
    calls,
    media,
    values,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
