import { measurementDefinitionVersion } from "../../../shared/domain/measurement";

const sourceFields = {
  views: { field: "views", unit: "count", appliesTo: "all" },
  reach: { field: "reach", unit: "count", appliesTo: "all" },
  likes: { field: "likes", unit: "count", appliesTo: "all" },
  comments: { field: "comments", unit: "count", appliesTo: "all" },
  saves: { field: "saved", unit: "count", appliesTo: "all" },
  shares: { field: "shares", unit: "count", appliesTo: "all" },
  reposts: { field: "reposts", unit: "count", appliesTo: "all" },
  totalInteractions: { field: "total_interactions", unit: "count", appliesTo: "all" },
  totalWatchTimeMs: {
    field: "ig_reels_video_view_total_time",
    unit: "milliseconds",
    appliesTo: "reels",
  },
  averageWatchTimeMs: {
    field: "ig_reels_avg_watch_time",
    unit: "milliseconds",
    appliesTo: "reels",
  },
  skipRate: { field: "reels_skip_rate", unit: "percent", appliesTo: "reels" },
  facebookViews: { field: "facebook_views", unit: "count", appliesTo: "all" },
  crosspostedViews: { field: "crossposted_views", unit: "count", appliesTo: "reels" },
  follows: { field: "follows", unit: "count", appliesTo: "feed" },
  profileVisits: { field: "profile_visits", unit: "count", appliesTo: "feed" },
} as const;

export const definitionVersion = measurementDefinitionVersion;
const meanings: Record<keyof typeof sourceFields, string> = {
  views: "Instagram plays/displays, including repeats; not unique viewers.",
  reach: "Estimated unique accounts reached by this media; never sum as account unique reach.",
  likes: "Instagram likes on this media; metadata fallback retains its own sourceField.",
  comments: "Instagram comment counter, distinct from locally saved comment texts.",
  saves: "Save actions (source saved), not unique saving people.",
  shares: "Share actions, distinct from reposts.",
  reposts: "Reposts less removed reposts; availability conflicts remain object-specific.",
  totalInteractions:
    "Native total_interactions; preserve independently of the derived component sum.",
  totalWatchTimeMs: "Total Reels playback milliseconds including replay; not completed viewers.",
  averageWatchTimeMs: "Average Reels playback milliseconds; average/duration is not completion.",
  skipRate:
    "Estimated initial views skipped in first 3 seconds / initial views * 100. Initial views denominator is not overall views.",
  facebookViews: "Facebook plays; separate surface from Instagram views.",
  crosspostedViews:
    "Combined Instagram+Facebook plays of crossposted Reels; do not add again to those surfaces.",
  follows:
    "Media following metric for FEED/STORY; Not requested for Reels by current collection policy; bounded v26.0 Instagram Login product rejections and documentation conflict do not establish universal unavailability.",
  profileVisits: "Profile visits from FEED/STORY media; not sales or all direct messages.",
};
export const metricDefinitions = Object.fromEntries(
  Object.entries(sourceFields).map(([key, definition]) => [
    key,
    {
      ...definition,
      level: "media",
      definition: meanings[key as keyof typeof meanings],
      definitionVersion,
      surface:
        key === "facebookViews"
          ? "facebook"
          : key === "crosspostedViews"
            ? "combined"
            : "instagram",
      distribution: ["likes", "comments", "saves", "shares", "totalInteractions"].includes(key)
        ? "organic"
        : "unknown",
      aggregation: "lifetime",
      login: "instagram_login",
      apiApplicability: "v26.0 verified; capability is object/parameters specific",
      denominator:
        key === "skipRate"
          ? "initial views"
          : key === "averageWatchTimeMs"
            ? "source playback denominator"
            : "none",
      limitations: [
        "Source may lag up to 48h; empty is not zero.",
        "Null reason does not establish source readiness.",
        "Do not impose monotonicity, views>=reach or equality of native and component totals.",
      ],
    },
  ]),
) as {
  [K in keyof typeof sourceFields]: (typeof sourceFields)[K] & {
    level: string;
    definition: string;
    definitionVersion: string;
    surface: "instagram" | "facebook" | "combined";
    distribution: "organic" | "unknown";
    aggregation: string;
    login: string;
    apiApplicability: string;
    denominator: string;
    limitations: string[];
  };
};
export const structuredDefinitions = {
  "comment.likeCount": {
    field: "like_count",
    unit: "count",
    appliesTo: "comment",
    definition:
      "Likes on a saved comment at the corresponding comment-page observation. Zero is known; absent is null. Current saved comment rows are mutable, not a complete historical like-count series.",
  },
  "story.navigation": {
    field: "navigation",
    unit: "count",
    appliesTo: "STORY",
    definition:
      "Navigation actions, broken down by story_navigation_action_type; categories can exist while total is null.",
  },
  "story.replies": {
    field: "replies",
    unit: "count",
    appliesTo: "STORY",
    definition:
      "Story replies; Europe/Japan exclusions and the available Story window apply. Not all messages or leads.",
  },
  "media.profileActivity": {
    field: "profile_activity",
    unit: "count",
    appliesTo: "FEED,STORY",
    definition:
      "Profile activity actions by action_type; current collection policy requests FEED/STORY, not Reels. Bounded product rejections and documentation conflict do not prove universal unavailability.",
  },
  "account.period": {
    field: "account_insights",
    unit: "count",
    appliesTo: "account",
    definition:
      "Native metrics for exact requested range, retaining returned period/end_time. Unique reach requires direct period total, never summed days or posts.",
  },
  "account.followerDemographics": {
    field: "follower_demographics",
    unit: "count",
    appliesTo: "audience",
    definition:
      "Follower population, literal Meta timeframe. Rolling 30d meaning is not assumed. Top categories and unknown exclusions; population percentages require known total.",
  },
  "account.engagedDemographics": {
    field: "engaged_audience_demographics",
    unit: "count",
    appliesTo: "audience",
    definition:
      "Engaged population; this_month rolling 30d and this_week rolling 7d in v20+. Different population from followers; unknown denominator remains null.",
  },
};
