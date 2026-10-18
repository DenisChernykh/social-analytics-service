import type { HttpAttempt, InstagramRequestPolicy } from "../application/ports";
import type { quotaObservation } from "../domain/request-policy";
import type { InstagramApiStatus } from "../public-contracts";

export class D1RequestPolicy implements InstagramRequestPolicy {
  private readonly states = new Map<string, InstagramApiStatus>();
  constructor(private readonly database: D1Database) {}
  async status(accountId: string, apiVersion: string, now: number): Promise<InstagramApiStatus> {
    const id = JSON.stringify([accountId, apiVersion]);
    const cached = this.states.get(id);
    if (cached)
      return {
        ...cached,
        quotaFreshness:
          cached.usageObservedAt === null
            ? "unknown"
            : now - cached.usageObservedAt > 3_600_000
              ? "stale"
              : "fresh",
        quotaStaleAfterMs: 3_600_000,
      };
    const row = await this.database
      .prepare(
        "SELECT recorded_requests AS recordedRequests,since_at AS sinceAt,usage_percent AS usagePercent,usage_observed_at AS usageObservedAt,blocked_until AS blockedUntil,observed_at AS observedAt,attempts,responses,failures_before_response AS failuresBeforeResponse,timeouts,rate_limited_responses AS rateLimitedResponses,accounting_since_at AS accountingSinceAt,usage_headers_json AS usageHeadersJson,(SELECT COUNT(*) FROM instagram_metric_support WHERE account_id=? AND api_version=? AND expires_at>?) AS cachedUnavailableMetrics FROM instagram_api_state WHERE id=?",
      )
      .bind(accountId, apiVersion, now, id)
      .first<
        InstagramApiStatus & {
          attempts: number;
          responses: number;
          failuresBeforeResponse: number;
          timeouts: number;
          rateLimitedResponses: number;
          accountingSinceAt: number | null;
          usageHeadersJson: string | null;
        }
      >();
    const result: InstagramApiStatus = row ?? {
      recordedRequests: 0,
      sinceAt: null,
      usagePercent: null,
      usageObservedAt: null,
      blockedUntil: 0,
      observedAt: null,
      cachedUnavailableMetrics: 0,
    };
    if (row) {
      result.http = {
        attempts: row.attempts,
        responses: row.responses,
        failuresBeforeResponse: row.failuresBeforeResponse,
        timeouts: row.timeouts,
        rateLimitedResponses: row.rateLimitedResponses,
        sinceAt: row.accountingSinceAt,
      };
      if (row.usageHeadersJson) result.usageHeaders = JSON.parse(row.usageHeadersJson);
    }
    result.quotaFreshness =
      result.usageObservedAt === null
        ? "unknown"
        : now - result.usageObservedAt > 3_600_000
          ? "stale"
          : "fresh";
    result.quotaStaleAfterMs = 3_600_000;
    this.states.set(id, result);
    return result;
  }
  async observe(
    accountId: string,
    apiVersion: string,
    now: number,
    usagePercent: number | null,
    blockedUntil: number,
  ) {
    const id = JSON.stringify([accountId, apiVersion]);
    await this.database
      .prepare(
        "INSERT INTO instagram_api_state (id,account_id,api_version,blocked_until,usage_percent,usage_observed_at,recorded_requests,since_at,observed_at) VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET blocked_until=MAX(instagram_api_state.blocked_until,excluded.blocked_until),usage_percent=COALESCE(excluded.usage_percent,instagram_api_state.usage_percent),usage_observed_at=COALESCE(excluded.usage_observed_at,instagram_api_state.usage_observed_at),recorded_requests=instagram_api_state.recorded_requests+1,observed_at=MAX(instagram_api_state.observed_at,excluded.observed_at)",
      )
      .bind(
        id,
        accountId,
        apiVersion,
        blockedUntil,
        usagePercent,
        usagePercent === null ? null : now,
        now,
        now,
      )
      .run();
    const previous = this.states.get(id);
    this.states.set(id, {
      recordedRequests: (previous?.recordedRequests ?? 0) + 1,
      sinceAt: previous?.sinceAt ?? now,
      usagePercent: usagePercent ?? previous?.usagePercent ?? null,
      usageObservedAt: usagePercent === null ? (previous?.usageObservedAt ?? null) : now,
      blockedUntil: Math.max(previous?.blockedUntil ?? 0, blockedUntil),
      observedAt: now,
      cachedUnavailableMetrics: previous?.cachedUnavailableMetrics ?? 0,
    });
  }
  async beginAttempt(attempt: HttpAttempt) {
    const id = JSON.stringify([attempt.accountId, attempt.requestedApiVersion]);
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO instagram_http_attempts(id,account_id,operation_id,object_id,requested_at,received_at,payload_json) VALUES(?,?,?,?,?,NULL,?)",
        )
        .bind(
          attempt.id,
          attempt.accountId,
          attempt.operationId,
          attempt.objectId,
          attempt.requestStartedAt,
          JSON.stringify(attempt),
        ),
      this.database
        .prepare(
          "INSERT INTO instagram_api_state(id,account_id,api_version,since_at,observed_at,attempts,accounting_since_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=instagram_api_state.attempts+1,accounting_since_at=COALESCE(instagram_api_state.accounting_since_at,excluded.accounting_since_at)",
        )
        .bind(
          id,
          attempt.accountId,
          attempt.requestedApiVersion,
          attempt.requestStartedAt,
          attempt.requestStartedAt,
          attempt.requestStartedAt,
        ),
    ]);
    const previous = this.states.get(id);
    if (previous)
      this.states.set(id, {
        ...previous,
        http: {
          attempts: (previous.http?.attempts ?? 0) + 1,
          responses: previous.http?.responses ?? 0,
          failuresBeforeResponse: previous.http?.failuresBeforeResponse ?? 0,
          timeouts: previous.http?.timeouts ?? 0,
          rateLimitedResponses: previous.http?.rateLimitedResponses ?? 0,
          sinceAt: previous.http?.sinceAt ?? attempt.requestStartedAt,
        },
      });
  }
  async finishAttempt(attempt: HttpAttempt, usage: ReturnType<typeof quotaObservation>) {
    const now = attempt.responseReceivedAt ?? attempt.failedAt ?? attempt.requestStartedAt;
    const id = JSON.stringify([attempt.accountId, attempt.requestedApiVersion]);
    const responded = attempt.httpStatus !== null;
    await this.database.batch([
      this.database
        .prepare("UPDATE instagram_http_attempts SET received_at=?,payload_json=? WHERE id=?")
        .bind(attempt.responseReceivedAt, JSON.stringify(attempt), attempt.id),
      this.database
        .prepare(
          "UPDATE instagram_api_state SET recorded_requests=recorded_requests+?,responses=responses+?,failures_before_response=failures_before_response+?,timeouts=timeouts+?,rate_limited_responses=rate_limited_responses+?,usage_headers_json=CASE WHEN ? THEN ? ELSE usage_headers_json END,blocked_until=MAX(blocked_until,?),usage_percent=COALESCE(?,usage_percent),usage_observed_at=COALESCE(?,usage_observed_at),observed_at=CASE WHEN ? THEN MAX(COALESCE(observed_at,0),?) ELSE observed_at END WHERE id=?",
        )
        .bind(
          Number(responded),
          Number(responded),
          Number(!responded),
          Number(attempt.result === "timeout"),
          Number(attempt.result === "rate_limited" || attempt.httpStatus === 429),
          Number(responded),
          JSON.stringify(usage.usageHeaders),
          usage.blockedUntil,
          usage.usagePercent,
          usage.usagePercent === null ? null : now,
          Number(responded),
          now,
          id,
        ),
    ]);
    const previous = this.states.get(id);
    if (previous)
      this.states.set(id, {
        ...previous,
        recordedRequests: previous.recordedRequests + Number(responded),
        sinceAt: previous.sinceAt ?? attempt.requestStartedAt,
        usagePercent: usage.usagePercent ?? previous.usagePercent,
        usageObservedAt: usage.usagePercent === null ? previous.usageObservedAt : now,
        blockedUntil: Math.max(previous.blockedUntil, usage.blockedUntil),
        observedAt: responded ? now : previous.observedAt,
        ...(responded ? { usageHeaders: usage.usageHeaders } : {}),
        http: {
          attempts: previous.http?.attempts ?? 1,
          responses: (previous.http?.responses ?? 0) + Number(responded),
          failuresBeforeResponse: (previous.http?.failuresBeforeResponse ?? 0) + Number(!responded),
          timeouts: (previous.http?.timeouts ?? 0) + Number(attempt.result === "timeout"),
          rateLimitedResponses:
            (previous.http?.rateLimitedResponses ?? 0) +
            Number(attempt.result === "rate_limited" || attempt.httpStatus === 429),
          sinceAt: previous.http?.sinceAt ?? attempt.requestStartedAt,
        },
      });
  }
  async unsupported(
    accountId: string,
    apiVersion: string,
    objectId: string,
    signature: string,
    now: number,
  ) {
    const rows = await this.database
      .prepare(
        "SELECT metric FROM instagram_metric_support WHERE account_id=? AND api_version=? AND object_id=? AND signature=? AND expires_at>?",
      )
      .bind(accountId, apiVersion, objectId, `ig-login:capability-v2:${signature}`, now)
      .all<{ metric: string }>();
    return rows.results.map((row) => row.metric);
  }
  async rememberUnsupported(
    accountId: string,
    apiVersion: string,
    objectId: string,
    signature: string,
    fields: string[],
    now: number,
  ) {
    if (!fields.length) return;
    await this.database.batch([
      this.database.prepare("DELETE FROM instagram_metric_support WHERE expires_at<=?").bind(now),
      ...[...new Set(fields)].map((metric) =>
        this.database
          .prepare(
            "INSERT INTO instagram_metric_support (id,account_id,api_version,object_id,signature,metric,observed_at,expires_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,expires_at=excluded.expires_at",
          )
          .bind(
            JSON.stringify([
              accountId,
              apiVersion,
              objectId,
              `ig-login:capability-v2:${signature}`,
              metric,
            ]),
            accountId,
            apiVersion,
            objectId,
            `ig-login:capability-v2:${signature}`,
            metric,
            now,
            now + 24 * 3_600_000,
          ),
      ),
    ]);
    this.states.delete(JSON.stringify([accountId, apiVersion]));
  }
}
