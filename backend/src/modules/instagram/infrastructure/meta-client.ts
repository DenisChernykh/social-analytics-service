import { z } from "zod";
import { ApplicationError, type ErrorCode } from "../../../shared/application/application-error";
import type { HttpAttempt, InstagramRequestPolicy, InstagramTransport } from "../application/ports";
import { quotaObservation } from "../domain/request-policy";
import type {
  CommentPage,
  InsightBatchQuery,
  InsightQuery,
  InstagramInsight,
  InstagramMedia,
  ReceiptReference,
  RequestBudget,
  StructuredInsight,
} from "../public-contracts";

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
  media_url: z.url().nullish(),
  thumbnail_url: z.url().nullish(),
  alt_text: z.string().nullish(),
  is_comment_enabled: z.boolean().nullish(),
  is_shared_to_feed: z.boolean().nullish(),
  media_audio_type: z.string().nullish(),
  is_ai_generated: z.boolean().nullish(),
  children: z
    .object({
      data: z
        .array(
          z.object({
            id: identifier,
            media_type: z.string(),
            media_url: z.url().nullish(),
            thumbnail_url: z.url().nullish(),
            alt_text: z.string().nullish(),
          }),
        )
        .max(50),
      paging: z.object({ next: z.string().optional() }).optional(),
    })
    .nullish(),
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
const storyCursorPrefix = "stories:v1:";
const storyCursorSchema = z.object({
  userId: identifier,
  pending: z.array(identifier).min(1).max(49),
  after: z.string().max(2048).nullable(),
});
function storyCursor(userId: string, pending: string[], after: string | null) {
  if (!pending.length) return after;
  return storyCursorPrefix + btoa(JSON.stringify({ userId, pending, after }));
}
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

const valueSchema = z.object({ value: z.unknown() });
const structuredInsightsSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      period: z.string().optional(),
      description: z.string().optional(),
      values: z.array(valueSchema.extend({ end_time: z.string().optional() })).optional(),
      total_value: z
        .object({
          value: z.unknown().optional(),
          breakdowns: z
            .array(
              z.object({
                dimension_keys: z.array(z.string()),
                results: z
                  .array(z.object({ dimension_values: z.array(z.string()), value: z.unknown() }))
                  .nullish(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  ),
});

const commentItemSchema = z.object({
  id: identifier,
  text: z.string(),
  timestamp: z.string(),
  parent_id: identifier.nullish(),
  from: z.object({ id: identifier.nullish(), username: z.string().nullish() }).nullish(),
  username: z.string().nullish(),
  like_count: count.nullable(),
  hidden: z.boolean().nullish(),
});
const commentPagingSchema = z
  .object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().optional() }).optional(),
  })
  .optional();
const commentsPageSchema = z.object({
  data: z
    .array(
      commentItemSchema.extend({
        replies: z
          .object({ data: z.array(commentItemSchema).max(50), paging: commentPagingSchema })
          .optional(),
      }),
    )
    .max(50),
  paging: commentPagingSchema,
});

class MetricUnavailable extends Error {
  constructor(
    readonly reason:
      | "not_supported"
      | "permission_required"
      | "insufficient_audience"
      | "before_account_conversion",
    readonly rejectedFields: string[] = [],
    readonly probeFields: string[] = [],
  ) {
    super(reason);
  }
}
// Reserved capability marker, never a metric name. Uses the existing 24-hour,
// account/object/API/query-scoped cache without another D1 lookup per request.
const beforeConversionMarker = ":before_account_conversion";
const beforeConversionMessage =
  "The media was posted before the most recent time that the user's account was converted to a business account from a personal account.";
class AudienceUnavailable extends Error {}
class OptionalFieldUnavailable extends Error {
  constructor(readonly field: string) {
    super("optional_field_unavailable");
  }
}
const baseMediaFields =
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count";
const mediaExtraFields = [
  "media_url",
  "thumbnail_url",
  "alt_text",
  "is_comment_enabled",
  "is_shared_to_feed",
  "media_audio_type",
  "is_ai_generated",
  "children",
];
const additionalFailureReasons: Partial<
  Record<ErrorCode, NonNullable<InstagramInsight["reason"]>>
> = {
  REQUEST_BUDGET_EXHAUSTED: "request_deferred",
  INSTAGRAM_RATE_LIMITED: "request_deferred",
  INSTAGRAM_UNAVAILABLE: "source_error",
  INSTAGRAM_SOURCE_ERROR: "source_error",
  INSTAGRAM_AUTH_EXPIRED: "permission_required",
  INSTAGRAM_PERMISSION_REQUIRED: "permission_required",
  INSTAGRAM_INVALID_REQUEST: "invalid_request",
  INSTAGRAM_INVALID_BREAKDOWN: "invalid_breakdown",
  INSTAGRAM_OBJECT_UNAVAILABLE: "object_unavailable",
};

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
    private readonly options: {
      policy?: InstagramRequestPolicy;
      accountId?: string;
      clock?: () => number;
      operationId?: string;
      budget?: RequestBudget;
      counters?: { attempts: number };
    } = {},
  ) {
    this.options.counters ??= { attempts: 0 };
  }
  requestStats() {
    return { attempts: this.options.counters?.attempts ?? 0 };
  }
  private lastReceipt: ReceiptReference | undefined;
  forOperation(operationId: string) {
    return new MetaClient(this.config, this.request, { ...this.options, operationId });
  }
  forAccount(accountId: string) {
    return new MetaClient(this.config, this.request, { ...this.options, accountId });
  }
  private get now() {
    return (this.options.clock ?? Date.now)();
  }
  private async unsupported(objectId: string, signature: string): Promise<string[]> {
    return this.options.accountId && this.options.policy
      ? this.options.policy.unsupported(
          this.options.accountId,
          this.config.apiVersion,
          objectId,
          signature,
          this.now,
        )
      : [];
  }
  private async rememberUnsupported(objectId: string, signature: string, fields: string[]) {
    if (this.options.accountId && this.options.policy && fields.length)
      await this.options.policy.rememberUnsupported(
        this.options.accountId,
        this.config.apiVersion,
        objectId,
        signature,
        fields,
        this.now,
      );
  }
  async subscribeComments(token: string, userId: string) {
    this.parsed(
      z.object({ success: z.literal(true) }),
      await this.json(
        this.graph(`${encodeURIComponent(userId)}/subscribed_apps`, {}),
        "media_catalog",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ subscribed_fields: "comments" }),
        },
      ),
    );
  }

  authorizationUrl(state: string, comments = false): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: `instagram_business_basic,instagram_business_manage_insights${comments ? ",instagram_business_manage_comments" : ""}`,
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
    optionalFields: string[] = [],
  ): Promise<unknown> {
    const { accountId, policy, budget } = this.options;
    if (accountId && policy) {
      const status = await policy.status(accountId, this.config.apiVersion, this.now);
      if (status.blockedUntil > this.now)
        throw new ApplicationError(
          "INSTAGRAM_RATE_LIMITED",
          "Instagram requests are paused until saved backoff expires.",
          status.blockedUntil - this.now,
        );
    }
    if (
      budget &&
      (budget.attempts >= budget.maxAttempts ||
        this.now + 15_000 >= budget.deadlineAt - budget.reserveMs)
    )
      throw new ApplicationError(
        "REQUEST_BUDGET_EXHAUSTED",
        "The bounded request portion must continue in a later tick.",
        300_000,
      );
    const parameters: Record<string, string> = {};
    for (const key of [
      "metric",
      "period",
      "metric_type",
      "timeframe",
      "breakdown",
      "since",
      "until",
      "limit",
      "fields",
    ]) {
      const value = url.searchParams.get(key);
      if (value !== null && /^[a-zA-Z0-9_,.(){}-]{0,2048}$/.test(value)) parameters[key] = value;
    }
    if (url.searchParams.has("after")) parameters.continuation = "present";
    const parts = url.pathname.split("/").filter(Boolean);
    const attempt: HttpAttempt = {
      id: crypto.randomUUID(),
      accountId: accountId ?? "",
      operationId: this.options.operationId ?? null,
      objectId: /^\d+$/.test(parts[1] ?? "") ? (parts[1] as string) : null,
      endpointFamily: ["insights", "comments", "replies"].includes(parts.at(-1) ?? "")
        ? (parts.at(-1) as string)
        : operation,
      parameters,
      requestStartedAt: this.now,
      responseReceivedAt: null,
      failedAt: null,
      requestedApiVersion: this.config.apiVersion,
      actualApiVersion: null,
      login: "instagram_login",
      httpStatus: null,
      graphCode: null,
      graphSubcode: null,
      result: "pending",
      sample: null,
    };
    if (accountId && policy?.beginAttempt) await policy.beginAttempt(attempt);
    if (budget) budget.attempts++;
    if (this.options.counters) this.options.counters.attempts++;
    let response: Response;
    let usage = quotaObservation(
      { retryAfter: null, appUsage: null, businessUsage: null },
      this.now,
    );
    const finish = async () => {
      if (accountId && policy?.finishAttempt) await policy.finishAttempt(attempt, usage);
      else if (accountId && policy && attempt.httpStatus !== null)
        await policy.observe(
          accountId,
          this.config.apiVersion,
          attempt.responseReceivedAt ?? this.now,
          usage.usagePercent,
          usage.blockedUntil,
        );
      this.lastReceipt =
        accountId && policy?.finishAttempt
          ? {
              receiptId: attempt.id,
              operationId: attempt.operationId,
              requestStartedAt: attempt.requestStartedAt,
              responseReceivedAt: attempt.responseReceivedAt,
              requestedApiVersion: attempt.requestedApiVersion,
              actualApiVersion: attempt.actualApiVersion,
              login: "instagram_login",
            }
          : undefined;
    };
    try {
      response = await this.request.call(globalThis, url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
    } catch (error) {
      attempt.failedAt = this.now;
      attempt.result =
        error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "timeout"
          : "transport_error";
      await finish();
      const failure = new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        `Instagram could not be reached during ${operation}; retry the request later.`,
      );
      failure.receipt = this.lastReceipt;
      throw failure;
    }
    attempt.httpStatus = response.status;
    const versionHeader =
      response.headers.get("facebook-api-version") ?? response.headers.get("instagram-api-version");
    attempt.actualApiVersion =
      versionHeader && /^v?\d{1,3}\.\d{1,3}$/.test(versionHeader) ? versionHeader : null;
    usage = quotaObservation(
      {
        retryAfter: response.headers.get("retry-after"),
        appUsage: response.headers.get("x-app-usage"),
        businessUsage: response.headers.get("x-business-use-case-usage"),
      },
      this.now,
    );
    let data: unknown;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      attempt.responseReceivedAt = this.now;
      attempt.result = "source_error";
      await finish();
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram returned an unexpected redirect; no credentials were forwarded.",
      );
    }
    try {
      data = await response.json();
    } catch (error) {
      attempt.responseReceivedAt = this.now;
      const timedOut =
        error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      attempt.failedAt = this.now;
      attempt.result = timedOut
        ? "timeout"
        : response.status === 429
          ? "rate_limited"
          : "source_error";
      if (response.status === 429)
        usage.blockedUntil = Math.max(
          usage.blockedUntil,
          this.now + (usage.retryAfterMs || 900_000),
        );
      await finish();
      const failure = new ApplicationError(
        response.status === 429 ? "INSTAGRAM_RATE_LIMITED" : "INSTAGRAM_UNAVAILABLE",
        response.status === 429
          ? "Instagram rate limit reached; retry later."
          : `Instagram returned an incomplete or invalid response during ${operation}.`,
        response.status === 429 ? usage.blockedUntil - this.now : undefined,
      );
      failure.receipt = this.lastReceipt;
      throw failure;
    }
    attempt.responseReceivedAt = this.now;
    if (data === null || typeof data !== "object") {
      attempt.result = "source_error";
      await finish();
      const failure = new ApplicationError(
        "INSTAGRAM_SOURCE_ERROR",
        "Meta returned a non-object response.",
      );
      failure.receipt = this.lastReceipt;
      throw failure;
    }
    const body = data as {
      error?: {
        code?: number;
        error_subcode?: number;
        is_transient?: boolean;
        message?: string;
        error_user_title?: string;
        error_user_msg?: string;
      };
      code?: number;
      error_type?: string;
      error_message?: string;
      data?: {
        name?: string;
        period?: string;
        values?: { value?: unknown }[];
        total_value?: { value?: unknown };
      }[];
    };
    const numeric = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
    attempt.graphCode = numeric(body?.error?.code ?? body?.code);
    attempt.graphSubcode = numeric(body?.error?.error_subcode);
    const code = attempt.graphCode,
      message = body?.error?.message ?? body?.error_message ?? "";
    const fields = metricRequest ? (url.searchParams.get("metric")?.split(",") ?? []) : [];
    const limited = response.status === 429 || [4, 17, 32, 613, 80002].includes(code ?? 0);
    let failure: Error | null = null;
    if (!response.ok || body?.error || body?.error_type) {
      if (limited) {
        attempt.result = "rate_limited";
        usage.blockedUntil = Math.max(
          usage.blockedUntil,
          this.now + (usage.retryAfterMs || 900_000),
        );
        failure = new ApplicationError(
          "INSTAGRAM_RATE_LIMITED",
          "Instagram rate limit reached; retry later.",
          usage.blockedUntil - this.now,
        );
      } else if (code === 190 || response.status === 401) {
        attempt.result = "permission_required";
        failure = new ApplicationError(
          "INSTAGRAM_AUTH_EXPIRED",
          "Reconnect Instagram; Meta rejected the access token.",
        );
      } else if (code === 100 && attempt.graphSubcode === 33) {
        attempt.result = "object_unavailable";
        failure = new ApplicationError(
          "INSTAGRAM_OBJECT_UNAVAILABLE",
          "Object existence or permissions could not be established through the Instagram API.",
        );
      } else if (code === 10 || code === 200 || response.status === 403) {
        attempt.result =
          metricRequest &&
          code === 10 &&
          /not enough viewers for the media to show insights/i.test(message)
            ? "insufficient_audience"
            : "permission_required";
        failure = metricRequest
          ? new MetricUnavailable(
              code === 10 && /not enough viewers for the media to show insights/i.test(message)
                ? "insufficient_audience"
                : "permission_required",
            )
          : new ApplicationError(
              "INSTAGRAM_PERMISSION_REQUIRED",
              "Grant required Instagram permissions and reconnect.",
            );
      } else if (
        metricRequest &&
        code === 3006 &&
        fields.some((f) => f.endsWith("_demographics"))
      ) {
        attempt.result = "insufficient_audience";
        failure = new AudienceUnavailable("insufficient_audience");
      } else if (
        metricRequest &&
        code === 100 &&
        attempt.graphSubcode === 2108006 &&
        (message === beforeConversionMessage ||
          body.error?.error_user_msg === beforeConversionMessage ||
          body.error?.error_user_title === "Media Posted Before Business Account Conversion")
      ) {
        attempt.result = "before_account_conversion";
        failure = new MetricUnavailable("before_account_conversion");
      } else if (metricRequest && code === 100) {
        const rejected = message.match(
          /does not support the metrics:\s*([a-z_]+(?:\s*,\s*[a-z_]+)*)\./i,
        )?.[1];
        const explicit =
          rejected
            ?.split(",")
            .map((f) => f.trim())
            .filter((f) => fields.includes(f)) ?? [];
        const productRejected = message.match(
          /does not support the ([a-z_]+) metric for this media product type/i,
        )?.[1];
        if (productRejected && fields.includes(productRejected)) explicit.push(productRejected);
        const single =
          fields.length === 1 &&
          /(?:metric.+(?:not supported|unsupported|not valid)|(?:not supported|unsupported).+metric)/i.test(
            message,
          ) &&
          !/(?:breakdown|parameter|period|timeframe)/i.test(message);
        if (explicit.length || single) {
          attempt.result = "not_supported";
          failure = new MetricUnavailable("not_supported", explicit.length ? explicit : fields);
        } else if (/breakdown/i.test(message)) {
          attempt.result = "invalid_breakdown";
          failure = new ApplicationError(
            "INSTAGRAM_INVALID_BREAKDOWN",
            "Meta rejected the requested breakdown or metric combination.",
          );
        } else if (/(?:invalid|parameter|period|timeframe|must be|should be)/i.test(message)) {
          attempt.result = "invalid_request";
          failure = new ApplicationError(
            "INSTAGRAM_INVALID_REQUEST",
            "Meta rejected the insight request parameters.",
          );
        } else {
          attempt.result = "source_error";
          failure = new ApplicationError(
            "INSTAGRAM_SOURCE_ERROR",
            "Meta rejected the insight request for an unclassified reason.",
          );
        }
      } else if (!metricRequest && code === 100) {
        const field = message.match(/nonexisting field \(([a-z_]+)\)/i)?.[1];
        if (field && optionalFields.includes(field)) {
          attempt.result = "not_supported";
          failure = new OptionalFieldUnavailable(field);
        }
      }
      if (
        !failure &&
        metricRequest &&
        response.status === 400 &&
        code === -1 &&
        attempt.graphSubcode === 2207086 &&
        body.error?.is_transient === false
      ) {
        attempt.result = "not_supported";
        failure = new MetricUnavailable(
          "not_supported",
          [],
          fields.filter((f) => f === "facebook_views" || f === "crossposted_views"),
        );
      }
      if (!failure) {
        attempt.result =
          response.status >= 500 || body.error?.is_transient === true
            ? "retryable"
            : "source_error";
        failure = new ApplicationError(
          attempt.result === "retryable" ? "INSTAGRAM_UNAVAILABLE" : "INSTAGRAM_SOURCE_ERROR",
          `Meta rejected ${operation} (HTTP ${response.status}, code ${code ?? "unknown"}).`,
        );
      }
      // Only numeric Graph codes/classification, never provider error text.
      attempt.sample = JSON.stringify({
        code: attempt.graphCode,
        subcode: attempt.graphSubcode,
        result: attempt.result,
      });
    } else {
      attempt.result = "success";
      if (metricRequest && Array.isArray(body.data)) {
        const sample = body.data
          .slice(0, 15)
          .filter(
            (i) =>
              i !== null &&
              typeof i === "object" &&
              typeof i.name === "string" &&
              fields.includes(i.name) &&
              /^[a-z_]{1,100}$/.test(i.name),
          )
          .map((i) => ({
            name: i.name,
            period:
              typeof i.period === "string" && /^[a-z_]{1,30}$/.test(i.period) ? i.period : null,
            value:
              typeof (i.total_value?.value ?? i.values?.[0]?.value) === "number" &&
              Number.isFinite(i.total_value?.value ?? i.values?.[0]?.value)
                ? (i.total_value?.value ?? i.values?.[0]?.value)
                : null,
          }));
        const encoded = JSON.stringify(sample);
        if (encoded.length <= 4096) attempt.sample = encoded;
      }
    }
    await finish();
    if (failure) {
      if (failure instanceof ApplicationError) failure.receipt = this.lastReceipt;
      throw failure;
    }
    return data;
  }

  private parsed<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path =
        issue?.path
          .filter(
            (part) =>
              typeof part === "number" || (typeof part === "string" && /^[a-z_]+$/.test(part)),
          )
          .join(".") ?? "response";
      const failure = new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        `The Instagram response did not match the expected API contract at ${path || "response"} (${issue?.code ?? "invalid_response"}).`,
      );
      failure.receipt = this.lastReceipt;
      throw failure;
    }
    return result.data;
  }

  private graph(path: string, parameters: Record<string, string> = {}) {
    const url = new URL(`https://graph.instagram.com/${this.config.apiVersion}/${path}`);
    url.search = new URLSearchParams(parameters).toString();
    return url;
  }
  private async richMediaRequest(
    token: string,
    objectId: string,
    signature: string,
    path: string,
    parameters: Record<string, string>,
  ) {
    const unsupported = new Set(await this.unsupported(objectId, signature));
    for (;;) {
      const budget = this.options.budget;
      const optional =
        budget &&
        (budget.deadlineAt - this.now - budget.reserveMs < 45_000 ||
          budget.maxAttempts - budget.attempts <= 3)
          ? []
          : mediaExtraFields.filter((field) => !unsupported.has(field));
      const fields = [
        baseMediaFields,
        ...optional.map((field) =>
          field === "children"
            ? `children.limit(50){id,media_type,media_url,thumbnail_url${unsupported.has("alt_text") ? "" : ",alt_text"}}`
            : field,
        ),
      ].join(",");
      try {
        return {
          data: await this.json(
            this.graph(path, { ...parameters, fields }),
            "media_catalog",
            { headers: { Authorization: `Bearer ${token}` } },
            false,
            optional,
          ),
          unsupported: [...unsupported],
          metadataDeferred:
            !!budget && optional.length === 0 && mediaExtraFields.some((f) => !unsupported.has(f)),
        };
      } catch (error) {
        if (!(error instanceof OptionalFieldUnavailable) || unsupported.has(error.field))
          throw error;
        unsupported.add(error.field);
        await this.rememberUnsupported(objectId, signature, [error.field]);
      }
    }
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
      receipt: this.lastReceipt,
      userId: profile.user_id,
      username: profile.username,
      accountType: profile.account_type,
      followersCount: profile.followers_count ?? null,
      mediaCount: profile.media_count ?? null,
    };
  }

  async mediaPage(token: string, userId: string, cursor: string | null, limit: number) {
    return this.catalogPage(token, userId, cursor, limit, "media");
  }
  async stories(token: string, userId: string, cursor: string | null, limit: number) {
    // Discover a bounded list independently of the atomic metrics page size.
    // Some source responses advertise another page when limit=1 even for one
    // active Story. Pending IDs survive eviction in the existing job cursor;
    // subsequent portions fetch each object's current metadata and metrics.
    if (cursor?.startsWith(storyCursorPrefix)) {
      let saved: z.infer<typeof storyCursorSchema>;
      try {
        saved = storyCursorSchema.parse(JSON.parse(atob(cursor.slice(storyCursorPrefix.length))));
        if (saved.userId !== userId) throw new Error("account");
      } catch {
        throw new ApplicationError("VALIDATION_FAILED", "Invalid Stories continuation cursor.");
      }
      const media: InstagramMedia[] = [];
      for (const id of saved.pending.slice(0, limit)) {
        const item = await this.media(token, id);
        if (item.id !== id)
          throw new ApplicationError("INSTAGRAM_UNAVAILABLE", "Unexpected Story identity.");
        media.push({ ...item, productType: "STORY" });
      }
      return {
        media,
        nextCursor: storyCursor(userId, saved.pending.slice(limit), saved.after),
      };
    }
    const page = await this.catalogPage(token, userId, cursor, 50, "stories");
    if (page.media.length > 50)
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram exceeded the Story list limit.",
      );
    return {
      media: page.media.slice(0, limit),
      nextCursor: storyCursor(
        userId,
        page.media.slice(limit).map((item) => item.id),
        page.nextCursor,
      ),
    };
  }
  private mapMedia(
    item: z.infer<typeof mediaSchema>,
    unsupportedFields: string[] = [],
    metadataDeferred = false,
  ): InstagramMedia {
    const timestamp = Date.parse(item.timestamp);
    if (!Number.isFinite(timestamp))
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram returned an invalid publication timestamp.",
      );
    return {
      receipt: this.lastReceipt,
      id: item.id,
      caption: item.caption ?? "",
      mediaType: item.media_type,
      productType: item.media_product_type ?? "UNKNOWN",
      permalink: item.permalink,
      timestamp,
      likeCount: item.like_count ?? null,
      commentsCount: item.comments_count ?? null,
      metadata: metadataDeferred
        ? undefined
        : {
            mediaUrl: item.media_url ?? null,
            thumbnailUrl: item.thumbnail_url ?? null,
            altText: item.alt_text ?? null,
            commentsEnabled: item.is_comment_enabled ?? null,
            sharedToFeed: item.is_shared_to_feed ?? null,
            audioType: item.media_audio_type ?? null,
            aiGenerated: item.is_ai_generated ?? null,
            children:
              item.children?.data.map((child) => ({
                id: child.id,
                mediaType: child.media_type,
                mediaUrl: child.media_url ?? null,
                thumbnailUrl: child.thumbnail_url ?? null,
                altText: child.alt_text ?? null,
              })) ?? null,
            childrenComplete: item.children ? !item.children.paging?.next : null,
            unsupportedFields,
          },
    };
  }
  async media(token: string, mediaId: string) {
    const result = await this.richMediaRequest(
      token,
      mediaId,
      "metadata:media",
      encodeURIComponent(mediaId),
      {},
    );
    return this.mapMedia(
      this.parsed(mediaSchema, result.data),
      result.unsupported,
      result.metadataDeferred,
    );
  }
  private async catalogPage(
    token: string,
    userId: string,
    cursor: string | null,
    limit: number,
    edge: "media" | "stories",
  ) {
    const parameters: Record<string, string> = {
      limit: String(limit),
    };
    if (cursor) parameters.after = cursor;
    const response = await this.richMediaRequest(
      token,
      userId,
      `metadata:${edge}`,
      `${encodeURIComponent(userId)}/${edge}`,
      parameters,
    );
    const data = this.parsed(mediaPageSchema, response.data);
    const result = data.data.map((item) => ({
      ...this.mapMedia(item, response.unsupported, response.metadataDeferred),
      productType: edge === "stories" ? "STORY" : (item.media_product_type ?? "UNKNOWN"),
    }));
    // Never follow paging.next: it may contain an access token or an unexpected host.
    const nextCursor = data.paging?.next ? (data.paging.cursors?.after ?? null) : null;
    if (data.paging?.next && !nextCursor)
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram pagination did not contain a cursor.",
      );
    if (cursor && nextCursor === cursor)
      throw new ApplicationError(
        "INSTAGRAM_PAGINATION_STALLED",
        "Instagram returned a repeated pagination cursor.",
      );
    return { media: result, nextCursor };
  }

  private async insightBatch(token: string, mediaId: string, fields: string[]) {
    const data = this.parsed(
      insightsSchema,
      await this.json(
        this.graph(`${encodeURIComponent(mediaId)}/insights`, {
          metric: fields.join(","),
          locale: "en_US",
        }),
        "insights",
        { headers: { Authorization: `Bearer ${token}` } },
        true,
      ),
    );
    const result: Record<string, InstagramInsight> = Object.fromEntries(
      fields.map((field) => [
        field,
        { value: null, reason: "not_returned", receipt: this.lastReceipt },
      ]),
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
          ? { value, reason: null, receipt: this.lastReceipt }
          : {
              value: null,
              reason: value == null ? "not_returned" : "invalid_value",
              receipt: this.lastReceipt,
            };
    }
    return result;
  }
  async insights(
    token: string,
    mediaId: string,
    fields: string[],
  ): Promise<Record<string, InstagramInsight>> {
    const result: Record<string, InstagramInsight> = {};
    const signature = "media:lifetime:scalar";
    const cached = await this.unsupported(mediaId, signature);
    let beforeConversion = cached.includes(beforeConversionMarker);
    if (beforeConversion)
      return Object.fromEntries(
        fields.map((field) => [field, { value: null, reason: "before_account_conversion" }]),
      );
    let pending = [...new Set(fields)].filter((field) => !cached.includes(field));
    const additionalOnly = fields.every(
      (field) => field === "facebook_views" || field === "crossposted_views",
    );
    for (const field of fields.filter((field) => cached.includes(field)))
      result[field] = { value: null, reason: "not_supported" };
    const individual = async (field: string) => {
      if (beforeConversion) {
        result[field] = { value: null, reason: "before_account_conversion" };
        return;
      }
      try {
        Object.assign(result, await this.insightBatch(token, mediaId, [field]));
      } catch (failure) {
        if (failure instanceof ApplicationError && failure.code === "REQUEST_BUDGET_EXHAUSTED") {
          result[field] = { value: null, reason: "request_deferred" };
          return;
        }
        if (additionalOnly && failure instanceof ApplicationError) {
          const reason = additionalFailureReasons[failure.code];
          if (reason) {
            result[field] = { value: null, reason, receipt: failure.receipt };
            return;
          }
        }
        if (!(failure instanceof MetricUnavailable)) throw failure;
        result[field] = { value: null, reason: failure.reason, receipt: this.lastReceipt };
        if (failure.reason === "before_account_conversion") {
          beforeConversion = true;
          await this.rememberUnsupported(mediaId, signature, [beforeConversionMarker]);
        }
        if (
          failure.reason === "not_supported" &&
          (failure.rejectedFields.includes(field) || failure.probeFields.includes(field))
        )
          await this.rememberUnsupported(mediaId, signature, [field]);
      }
    };
    if (
      additionalOnly &&
      this.options.budget &&
      pending.length > 1 &&
      this.options.budget.maxAttempts - this.options.budget.attempts <= pending.length
    ) {
      // A failing optional batch would consume the last slot without resolving any field.
      // Isolated requests use at most one remaining attempt per field, under the same budget.
      for (const field of pending) await individual(field);
      return result;
    }
    while (pending.length) {
      try {
        Object.assign(result, await this.insightBatch(token, mediaId, pending));
        return result;
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "REQUEST_BUDGET_EXHAUSTED") {
          for (const field of pending) result[field] = { value: null, reason: "request_deferred" };
          return result;
        }
        if (!(error instanceof MetricUnavailable)) throw error;
        if (error.reason === "before_account_conversion")
          await this.rememberUnsupported(mediaId, signature, [beforeConversionMarker]);
        if (error.reason !== "not_supported" || pending.length === 1) {
          if (error.reason === "not_supported")
            await this.rememberUnsupported(
              mediaId,
              signature,
              pending.filter(
                (field) =>
                  error.rejectedFields.includes(field) ||
                  (pending.length === 1 && error.probeFields.includes(field)),
              ),
            );
          for (const field of pending)
            result[field] = { value: null, reason: error.reason, receipt: this.lastReceipt };
          return result;
        }
        if (error.rejectedFields.length) {
          await this.rememberUnsupported(mediaId, signature, error.rejectedFields);
          for (const field of error.rejectedFields)
            result[field] = { value: null, reason: "not_supported", receipt: this.lastReceipt };
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

  private structuredValue(
    query: InsightQuery,
    item?: z.infer<typeof structuredInsightsSchema>["data"][number],
  ): StructuredInsight {
    const result: StructuredInsight = {
      receipt: this.lastReceipt,
      metric: query.metric,
      period: query.period,
      metricType: query.metricType,
      value: null,
      reason: "not_returned",
      description: null,
      points: [],
      breakdowns: [],
    };
    if (!item) return result;
    const number = (value: unknown): InstagramInsight =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
        ? { value, reason: null }
        : { value: null, reason: value == null ? "not_returned" : "invalid_value" };
    return {
      ...result,
      ...number(
        item.total_value?.value ??
          (query.period === "lifetime" && item.values?.length === 1
            ? item.values[0]?.value
            : undefined),
      ),
      period: item.period ?? query.period,
      description: item.description ?? null,
      points: (item.values ?? [])
        .filter((point) => query.metricType === "time_series" || point.end_time !== undefined)
        .map((point) => {
          const endTime = point.end_time === undefined ? NaN : Date.parse(point.end_time);
          if (!Number.isFinite(endTime))
            throw new ApplicationError(
              "INSTAGRAM_UNAVAILABLE",
              "Instagram returned an invalid insight period.",
            );
          return { ...number(point.value), endTime };
        }),
      breakdowns: (item.total_value?.breakdowns ?? []).map((group) => ({
        dimensions: group.dimension_keys,
        results: (group.results ?? []).map((entry) => ({
          categories: entry.dimension_values,
          ...number(entry.value),
        })),
      })),
    };
  }
  async structuredInsights(
    token: string,
    objectId: string,
    query: InsightQuery,
  ): Promise<StructuredInsight> {
    return (
      (
        await this.structuredInsightsBatch(token, objectId, { ...query, metrics: [query.metric] })
      )[0] ?? this.structuredValue(query)
    );
  }
  async structuredInsightsBatch(
    token: string,
    objectId: string,
    query: InsightBatchQuery,
  ): Promise<StructuredInsight[]> {
    const fields = [...new Set(query.metrics)];
    const signature = JSON.stringify([
      query.period,
      query.metricType,
      query.breakdown,
      query.timeframe,
      query.since,
      query.until,
    ]);
    const cached = await this.unsupported(objectId, signature);
    if (cached.includes(beforeConversionMarker))
      return fields.map((metric) => ({
        ...this.structuredValue({ ...query, metric }),
        reason: "before_account_conversion",
        receipt: undefined,
      }));
    const results = new Map<string, StructuredInsight>();
    for (const metric of fields.filter((field) => cached.includes(field)))
      results.set(metric, {
        ...this.structuredValue({ ...query, metric }),
        reason: "not_supported",
        receipt: undefined,
      });
    let pending = fields.filter((field) => !cached.includes(field));
    while (pending.length) {
      const parameters: Record<string, string> = {
        metric: pending.join(","),
        period: query.period,
        metric_type: query.metricType,
        locale: "en_US",
      };
      if (query.since !== undefined) parameters.since = String(Math.floor(query.since / 1000));
      if (query.until !== undefined) parameters.until = String(Math.floor(query.until / 1000));
      if (query.breakdown) parameters.breakdown = query.breakdown;
      if (query.timeframe) parameters.timeframe = query.timeframe;
      try {
        const data = this.parsed(
          structuredInsightsSchema,
          await this.json(
            this.graph(`${encodeURIComponent(objectId)}/insights`, parameters),
            "insights",
            { headers: { Authorization: `Bearer ${token}` } },
            true,
          ),
        );
        for (const metric of pending)
          results.set(
            metric,
            this.structuredValue(
              { ...query, metric },
              data.data.find((item) => item.name === metric),
            ),
          );
        break;
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "REQUEST_BUDGET_EXHAUSTED") {
          for (const metric of pending)
            results.set(metric, {
              ...this.structuredValue({ ...query, metric }),
              receipt: undefined,
              reason: "request_deferred",
            });
          break;
        }
        if (error instanceof AudienceUnavailable) {
          if (pending.length === 1)
            results.set(pending[0] as string, {
              ...this.structuredValue({ ...query, metric: pending[0] as string }),
              reason: "insufficient_audience",
            });
          else
            for (const metric of pending)
              results.set(
                metric,
                await this.structuredInsights(token, objectId, { ...query, metric }),
              );
          break;
        }
        if (!(error instanceof MetricUnavailable)) throw error;
        if (error.reason === "before_account_conversion")
          await this.rememberUnsupported(objectId, signature, [beforeConversionMarker]);
        if (error.rejectedFields.length) {
          await this.rememberUnsupported(objectId, signature, error.rejectedFields);
          for (const metric of error.rejectedFields)
            results.set(metric, {
              ...this.structuredValue({ ...query, metric }),
              reason: error.reason,
            });
          pending = pending.filter((metric) => !error.rejectedFields.includes(metric));
          continue;
        }
        if (error.reason !== "not_supported" || pending.length === 1) {
          for (const metric of pending)
            results.set(metric, {
              ...this.structuredValue({ ...query, metric }),
              reason: error.reason,
            });
          if (error.probeFields.length)
            await this.rememberUnsupported(objectId, signature, error.probeFields);
          break;
        }
        for (const metric of pending)
          results.set(metric, await this.structuredInsights(token, objectId, { ...query, metric }));
        break;
      }
    }
    return fields.map(
      (metric) => results.get(metric) ?? this.structuredValue({ ...query, metric }),
    );
  }
  async comments(
    token: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
    expandReplies = false,
  ): Promise<CommentPage> {
    const expanded = expandReplies && !replies;
    const parameters: Record<string, string> = {
      fields: expanded
        ? "id,text,timestamp,parent_id,from,username,like_count,hidden,replies.limit(50){id,text,timestamp,parent_id,from,username,like_count,hidden}"
        : "id,text,timestamp,parent_id,from,username,like_count,hidden",
      limit: String(limit),
    };
    if (cursor) parameters.after = cursor;
    const page = this.parsed(
      commentsPageSchema,
      await this.json(
        this.graph(
          `${encodeURIComponent(objectId)}/${replies ? "replies" : "comments"}`,
          parameters,
        ),
        "media_catalog",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    if (expanded && page.data.length > limit)
      throw new ApplicationError(
        "INSTAGRAM_UNAVAILABLE",
        "Instagram exceeded the bounded expanded comment page size.",
      );
    const next = (paging: z.infer<typeof commentPagingSchema>) => {
      const cursor = paging?.next ? (paging.cursors?.after ?? null) : null;
      if (paging?.next && !cursor)
        throw new ApplicationError(
          "INSTAGRAM_UNAVAILABLE",
          "Instagram pagination did not contain a cursor.",
        );
      return cursor;
    };
    const map = (item: z.infer<typeof commentItemSchema>, parentId: string | null) => {
      const publishedAt = Date.parse(item.timestamp);
      if (!Number.isFinite(publishedAt))
        throw new ApplicationError(
          "INSTAGRAM_UNAVAILABLE",
          "Instagram returned an invalid comment timestamp.",
        );
      return {
        id: item.id,
        text: item.text,
        publishedAt,
        parentId: item.parent_id ?? parentId,
        authorId: item.from?.id ?? null,
        authorUsername: item.from?.username ?? item.username ?? null,
        likeCount: item.like_count ?? null,
        hidden: item.hidden ?? null,
      };
    };
    const items = new Map<string, CommentPage["items"][number]>();
    const branches: NonNullable<CommentPage["replyBranches"]> = [];
    for (const root of page.data) {
      const mapped = map(root, replies ? objectId : null);
      const previous = items.get(root.id);
      items.set(root.id, { ...mapped, parentId: mapped.parentId ?? previous?.parentId ?? null });
      if (!expanded || mapped.parentId) continue;
      const cursor = root.replies ? next(root.replies.paging) : null;
      branches.push({
        parentId: root.id,
        nextCursor: cursor,
        status: !root.replies ? "omitted" : cursor ? "partial" : "exhausted",
      });
      for (const reply of root.replies?.data ?? []) {
        if (reply.id === root.id || (reply.parent_id && reply.parent_id !== root.id))
          throw new ApplicationError(
            "INSTAGRAM_UNAVAILABLE",
            "Instagram returned an inconsistent reply parent.",
          );
        items.set(reply.id, map(reply, root.id));
      }
    }
    return {
      items: [...items.values()],
      receipt: this.lastReceipt,
      nextCursor: next(page.paging),
      ...(expanded
        ? { replyBranches: branches.filter((branch) => !items.get(branch.parentId)?.parentId) }
        : {}),
    };
  }
}
