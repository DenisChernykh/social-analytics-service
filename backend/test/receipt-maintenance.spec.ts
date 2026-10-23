import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAttempt } from "../src/modules/instagram/application/ports";
import { quotaObservation } from "../src/modules/instagram/domain/request-policy";
import { D1ReceiptMaintenance } from "../src/modules/instagram/infrastructure/d1-receipt-maintenance";
import { D1RequestPolicy } from "../src/modules/instagram/infrastructure/d1-request-policy";

import { accountId, connect, fixture } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
  await connect(fixture());
});

const day = 86_400_000;
const now = Date.parse("2026-10-19T12:00:00Z");
afterEach(() => vi.restoreAllMocks());

async function receipt(id: string, age: number) {
  await env.DB.prepare(
    "INSERT INTO instagram_http_attempts(id,account_id,requested_at,payload_json) VALUES(?,?,?,?)",
  )
    .bind(id, accountId, now - age, JSON.stringify({ sample: "diagnostic", result: "success" }))
    .run();
}

describe("daily receipt maintenance", () => {
  it("bounds each portion and retains recent receipts, metadata and exact retention boundaries", async () => {
    await env.DB.prepare("DELETE FROM instagram_http_attempts").run();
    for (let i = 0; i < 105; i++) await receipt(`expired-${i}`, 31 * day);
    await receipt("old-sample", 8 * day);
    await receipt("seven-day-boundary", 7 * day);
    await receipt("thirty-day-boundary", 30 * day);
    await receipt("recent", day);
    const maintenance = new D1ReceiptMaintenance(env.DB);
    expect(await maintenance.pruneReceipts(now)).toEqual({ more: true });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM instagram_http_attempts WHERE id LIKE 'expired-%'",
      ).first(),
    ).toEqual({ n: 5 });
    expect(await maintenance.pruneReceipts(now)).toEqual({ more: false });
    const rows = await env.DB.prepare(
      "SELECT id,json_extract(payload_json,'$.sample') sample,json_extract(payload_json,'$.result') result FROM instagram_http_attempts ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: "old-sample", sample: null, result: "success" },
      { id: "recent", sample: "diagnostic", result: "success" },
      { id: "seven-day-boundary", sample: "diagnostic", result: "success" },
      { id: "thirty-day-boundary", sample: null, result: "success" },
    ]);
    expect(await maintenance.pruneReceipts(now)).toEqual({ more: false });
  });

  it("limits sample updates to 100 per portion", async () => {
    await env.DB.prepare("DELETE FROM instagram_http_attempts").run();
    for (let i = 0; i < 105; i++) await receipt(`sample-${i}`, 8 * day);
    const maintenance = new D1ReceiptMaintenance(env.DB);
    expect(await maintenance.pruneReceipts(now)).toEqual({ more: true });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM instagram_http_attempts WHERE json_extract(payload_json,'$.sample') IS NOT NULL",
      ).first(),
    ).toEqual({ n: 5 });
    expect(await maintenance.pruneReceipts(now)).toEqual({ more: false });
  });

  it("records HTTP results without issuing retention queries on the collection path", async () => {
    const attempt = {
      id: crypto.randomUUID(),
      accountId: accountId,
      operationId: null,
      objectId: null,
      endpointFamily: "insights",
      parameters: {},
      requestStartedAt: now,
      responseReceivedAt: now + 1,
      failedAt: null,
      requestedApiVersion: "v26.0",
      actualApiVersion: "v26.0",
      login: "instagram_login",
      httpStatus: 200,
      graphCode: null,
      graphSubcode: null,
      result: "success",
      sample: null,
    } satisfies HttpAttempt;
    const policy = new D1RequestPolicy(env.DB);
    const prepare = vi.spyOn(env.DB, "prepare");
    await policy.beginAttempt(attempt);
    await policy.finishAttempt(
      attempt,
      quotaObservation({ retryAfter: null, appUsage: null, businessUsage: null }, now),
    );
    const queries = prepare.mock.calls.map(([sql]) => sql);
    expect(queries.some((sql) => sql.includes("DELETE FROM instagram_http_attempts"))).toBe(false);
    // Freshness now updates the same accounting row; it adds no SQL write.
    expect(queries).toHaveLength(4);
    expect(
      await env.DB.prepare("SELECT received_at FROM instagram_http_attempts WHERE id=?")
        .bind(attempt.id)
        .first(),
    ).toEqual({ received_at: now + 1 });
  });
});
