import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { ageSnapshotWindows } from "../src/modules/collection/domain/age-policy";
import { D1Collection } from "../src/modules/collection/infrastructure/d1-collection";
import { databaseDailyLimitError } from "../src/platform/database/d1-errors";
import { testKey } from "./helpers";

const now = Date.parse("2026-10-18T23:58:00Z");
const quota = (kind: string) =>
  new Error(
    `D1_ERROR: Your account has exceeded D1's free tier daily row ${kind} limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.`,
  );

describe("D1 daily capacity", () => {
  it.each(["read", "write"])(
    "classifies wrapped %s quota errors without exposing query parameters",
    (kind) => {
      const error = new Error("Failed query with private parameters", { cause: quota(kind) });
      expect(databaseDailyLimitError(error, now)).toMatchObject({
        code: "DATABASE_DAILY_LIMIT_REACHED",
        retryAfterMs: 125_000,
      });
      expect(databaseDailyLimitError(error, now)?.message).not.toContain("private parameters");
    },
  );

  it("keeps transient and unrelated D1 failures out of the daily pause", () => {
    expect(
      databaseDailyLimitError(new Error("D1 DB reset because its code was updated."), now),
    ).toBeNull();
    expect(databaseDailyLimitError(new Error("SQLITE_ERROR: no such column"), now)).toBeNull();
  });

  it("returns a safe 503 and Retry-After from an authenticated read instead of a generic 500", async () => {
    const app = createApp({ clock: () => now });
    const db = {
      prepare() {
        throw new Error("private-query-parameter", { cause: quota("read") });
      },
    } as unknown as D1Database;
    const response = await app.request(
      "/api/accounts",
      { headers: { Authorization: `Bearer ${testKey}` } },
      { ...env, DB: db },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("125");
    const body = await response.text();
    expect(body).toContain("DATABASE_DAILY_LIMIT_REACHED");
    expect(body).not.toContain("private-query-parameter");
  });

  it("uses bounded index ranges for receipt maintenance and the latest receipt/account observation", async () => {
    for (const [sql, params, index] of [
      [
        "SELECT id FROM instagram_http_attempts WHERE requested_at<? LIMIT 100",
        [now],
        "instagram_attempt_time",
      ],
      [
        "SELECT id FROM instagram_http_attempts WHERE requested_at<? AND json_extract(payload_json,'$.sample') IS NOT NULL LIMIT 100",
        [now],
        "instagram_attempt_sample_time",
      ],
      [
        "SELECT json_extract(payload_json,'$.result') FROM instagram_http_attempts WHERE account_id=? ORDER BY requested_at DESC,id DESC LIMIT 1",
        ["account"],
        "instagram_attempt_account_time",
      ],
      [
        "SELECT id FROM account_insights WHERE account_id=? AND observed_at>=?",
        ["account", now],
        "account_insights_account_time",
      ],
    ] as const) {
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...params)
        .all<{ detail: string }>();
      expect(plan.results.map((row) => row.detail).join("\n")).toContain(index);
      expect(plan.results.map((row) => row.detail).join("\n")).not.toContain(
        "USE TEMP B-TREE FOR ORDER BY",
      );
    }
  });

  it("bounds age eligibility scans by indexed publication time for each target", async () => {
    let query = "";
    const prepare = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.startsWith("WITH targets")) query = sql;
      return prepare(sql);
    });
    try {
      await new D1Collection(env.DB).dueAgeMedia("account", now);
    } finally {
      spy.mockRestore();
    }
    expect(query).not.toBe("");
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(
        ...ageSnapshotWindows.flatMap((t) => [t.targetHours, t.toleranceHours]),
        "account",
        now,
        now,
        now,
      )
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("media_account_published");
    expect(details).toContain("published_at>?");
    expect(details).toContain("published_at<?");
  });
});
