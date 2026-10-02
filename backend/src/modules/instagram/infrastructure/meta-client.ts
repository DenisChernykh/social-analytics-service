import { z } from "zod";
import { ApplicationError } from "../../../shared/application/application-error";
import type { InstagramTransport } from "../application/ports";
import type { InstagramInsight } from "../public-contracts";

const identifier = z.string().regex(/^\d+$/);
const count = z.number().finite().nonnegative().safe().optional();
const profileSchema = z.object({
  user_id: identifier,
  username: z.string(),
  account_type: z.string(),
  followers_count: count,
  media_count: count,
});
const mediaSchema = z.object({
  id: identifier,
  caption: z.string().optional(),
  media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  media_product_type: z.string().optional(),
  permalink: z.url(),
  timestamp: z.string(),
  like_count: count,
  comments_count: count,
});
const mediaPageSchema = z.object({
  data: z.array(mediaSchema),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});
const insightsSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.object({ value: z.unknown() })).optional(),
      total_value: z.object({ value: z.unknown().optional() }).optional(),
    }),
  ),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z
    .number()
    .int()
    .positive()
    .max(90 * 86_400),
});
const shortSchema = z.object({
  access_token: z.string().min(1),
  permissions: z.union([z.string(), z.array(z.string())]).optional(),
});

class MetricUnavailable extends Error {
  constructor(
    readonly reason: "not_supported" | "permission_required",
    readonly rejectedFields: string[] = [],
    readonly probeFields: string[] = [],
  ) {
    super(reason);
  }
}

export type MetaClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiVersion: string;
};

type MetaOperation =
  | "token_exchange"
  | "token_extension"
  | "token_refresh"
  | "profile"
  | "media_catalog"
  | "insights";

export class MetaClient implements InstagramTransport {
  constructor(
    private readonly config: MetaClientConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_insights",
      state,
      enable_fb_login: "false",
    }).toString();
    return url.toString();
  }

  private async json(
    url: URL,
    operation: MetaOperation,
    init: RequestInit = {},
    metricRequest = false,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request.call(globalThis, url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
    } catch {
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        `Instagram could not be reached during ${operation}; retry the request later.`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram returned an unexpected redirect; no credentials were forwarded.",
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        `Instagram returned an invalid response during ${operation}.`,
      );
    }
    const body = data as {
      error?: { code?: number; error_subcode?: number; is_transient?: boolean; message?: string };
      code?: number;
      error_type?: string;
      error_message?: string;
    };
    if (!response.ok || body?.error || body?.error_type) {
      const code = body?.error?.code ?? body?.code;
      if (response.status === 429 || [4, 17, 32, 613, 80002].includes(code ?? 0))
        throw new ApplicationError(
          "INSTAGRAM_RATE_LIMITED",
          "Instagram rate limit reached; retry later.",
        );
      if (code === 190 || response.status === 401)
        throw new ApplicationError(
          "INSTAGRAM_AUTH_EXPIRED",
          "Reconnect Instagram; Meta rejected the access token.",
        );
      if (code === 10 || code === 200 || response.status === 403) {
        if (metricRequest) throw new MetricUnavailable("permission_required");
        throw new ApplicationError(
          "INSTAGRAM_PERMISSION_REQUIRED",
          "Grant the required Instagram permissions and connect again.",
        );
      }
      const fields = metricRequest ? (url.searchParams.get("metric")?.split(",") ?? []) : [];
      if (metricRequest && code === 100) {
        const message = body.error?.message ?? body.error_message;
        const rejected =
          typeof message === "string"
            ? message.match(/does not support the metrics:\s*([a-z_]+(?:\s*,\s*[a-z_]+)*)\./i)?.[1]
            : undefined;
        const rejectedFields =
          rejected
            ?.split(",")
            .map((field) => field.trim())
            .filter((field) => fields.includes(field)) ?? [];
        throw new MetricUnavailable("not_supported", rejectedFields);
      }
      // Meta uses this non-transient response for unavailable crossposting insights.
      if (
        metricRequest &&
        response.status === 400 &&
        code === -1 &&
        body.error?.error_subcode === 2207086 &&
        body.error.is_transient === false
      )
        throw new MetricUnavailable(
          "not_supported",
          [],
          fields.filter((field) => field === "facebook_views" || field === "crossposted_views"),
        );
      const safeCode =
        typeof code === "number" &&
        Number.isSafeInteger(code) &&
        code >= -1_000_000_000 &&
        code <= 1_000_000_000
          ? code
          : "unknown";
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        `Meta rejected the ${operation} request (HTTP ${response.status}, code ${safeCode}).`,
      );
    }
    return data;
  }

  private parsed<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success)
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "The Instagram response did not match the expected API contract.",
      );
    return result.data;
  }

  private graph(path: string, parameters: Record<string, string> = {}) {
    const url = new URL(`https://graph.instagram.com/${this.config.apiVersion}/${path}`);
    url.search = new URLSearchParams(parameters).toString();
    return url;
  }

  async exchangeCode(code: string) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
      code,
    }))
      form.set(key, value);
    const response = await this.json(
      new URL("https://api.instagram.com/oauth/access_token"),
      "token_exchange",
      {
        method: "POST",
        body: form,
      },
    );
    const data = response as { data?: unknown[] };
    const token = this.parsed(shortSchema, Array.isArray(data?.data) ? data.data[0] : response);
    return {
      accessToken: token.access_token,
      scopes:
        typeof token.permissions === "string"
          ? token.permissions.split(",").map((s) => s.trim())
          : (token.permissions ?? []),
    };
  }
  async extendToken(token: string) {
    const url = new URL("https://graph.instagram.com/access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: this.config.clientSecret,
      access_token: token,
    }).toString();
    const result = this.parsed(tokenSchema, await this.json(url, "token_extension"));
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  }
  async refreshToken(token: string) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    }).toString();
    const result = this.parsed(tokenSchema, await this.json(url, "token_refresh"));
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  }

  async profile(token: string) {
    const response = await this.json(
      this.graph("me", { fields: "user_id,username,account_type,followers_count,media_count" }),
      "profile",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = response as { data?: unknown[] };
    const profile = this.parsed(profileSchema, Array.isArray(body?.data) ? body.data[0] : response);
    return {
      userId: profile.user_id,
      username: profile.username,
      accountType: profile.account_type,
      followersCount: profile.followers_count ?? null,
      mediaCount: profile.media_count ?? null,
    };
  }

  async mediaPage(token: string, userId: string, cursor: string | null, limit: number) {
    const parameters: Record<string, string> = {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: String(limit),
    };
    if (cursor) parameters.after = cursor;
    const data = this.parsed(
      mediaPageSchema,
      await this.json(
        this.graph(`${encodeURIComponent(userId)}/media`, parameters),
        "media_catalog",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    const result = data.data.map((item) => {
      const timestamp = Date.parse(item.timestamp);
      if (!Number.isFinite(timestamp))
        throw new ApplicationError(
          "INSTAGRAM_UNAVAILABLE",
          "Instagram returned an invalid publication timestamp.",
        );
      return {
        id: item.id,
        caption: item.caption ?? "",
        mediaType: item.media_type,
        productType: item.media_product_type ?? "UNKNOWN",
        permalink: item.permalink,
        timestamp,
        likeCount: item.like_count ?? null,
        commentsCount: item.comments_count ?? null,
      };
    });
    // Never follow paging.next: it may contain an access token or an unexpected host.
    const nextCursor = data.paging?.next ? (data.paging.cursors?.after ?? null) : null;
    if (data.paging?.next && !nextCursor)
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram pagination did not contain a cursor.",
      );
    return { media: result, nextCursor };
  }

  private async insightBatch(token: string, mediaId: string, fields: string[]) {
    const data = this.parsed(
      insightsSchema,
      await this.json(
        this.graph(`${encodeURIComponent(mediaId)}/insights`, { metric: fields.join(",") }),
        "insights",
        { headers: { Authorization: `Bearer ${token}` } },
        true,
      ),
    );
    const result: Record<string, InstagramInsight> = Object.fromEntries(
      fields.map((field) => [field, { value: null, reason: "not_returned" }]),
    );
    for (const item of data.data) {
      if (!fields.includes(item.name)) continue;
      const value =
        item.total_value?.value ?? (item.values?.length === 1 ? item.values[0]?.value : undefined);
      result[item.name] =
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= Number.MAX_SAFE_INTEGER
          ? { value, reason: null }
          : { value: null, reason: value == null ? "not_returned" : "invalid_value" };
    }
    return result;
  }
  async insights(
    token: string,
    mediaId: string,
    fields: string[],
  ): Promise<Record<string, InstagramInsight>> {
    const result: Record<string, InstagramInsight> = {};
    let pending = [...new Set(fields)];
    const individual = async (field: string) => {
      try {
        Object.assign(result, await this.insightBatch(token, mediaId, [field]));
      } catch (failure) {
        if (!(failure instanceof MetricUnavailable)) throw failure;
        result[field] = { value: null, reason: failure.reason };
      }
    };
    while (pending.length) {
      try {
        Object.assign(result, await this.insightBatch(token, mediaId, pending));
        return result;
      } catch (error) {
        if (!(error instanceof MetricUnavailable)) throw error;
        if (error.reason === "permission_required" || pending.length === 1) {
          for (const field of pending) result[field] = { value: null, reason: error.reason };
          return result;
        }
        if (error.rejectedFields.length) {
          for (const field of error.rejectedFields)
            result[field] = { value: null, reason: "not_supported" };
          pending = pending.filter((field) => !error.rejectedFields.includes(field));
          continue;
        }
        if (error.probeFields.length) {
          for (const field of error.probeFields) await individual(field);
          pending = pending.filter((field) => !error.probeFields.includes(field));
          continue;
        }
        // Unknown unsupported batches are checked individually without guessing values.
        for (const field of pending) await individual(field);
        return result;
      }
    }
    return result;
  }
}
