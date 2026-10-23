import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { accountInsights } from "../../../platform/database/schema";
import type { InsightSelection, InsightStore } from "../application/ports";
import type { InsightCollection } from "../domain/model";

export class D1Insights implements InsightStore {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async periodObservations(accountId: string, timeZone: string, apiVersion: string, since: number) {
    const row = await this.database
      .prepare("SELECT activity_periods_json periods FROM accounts WHERE id=?")
      .bind(accountId)
      .first<{ periods: string }>();
    return Object.entries(JSON.parse(row?.periods ?? "{}") as Record<string, number>).flatMap(
      ([key, observedAt]) => {
        const [version, zone, from, to] = key.split("|");
        return version === apiVersion && zone === timeZone && observedAt >= since
          ? [{ from: Number(from), to: Number(to), observedAt }]
          : [];
      },
    );
  }

  async expireAttempts(now: number) {
    const result = await this.database
      .prepare(`UPDATE account_insights
      SET payload_json=json_set(payload_json,'$.status','failed','$.errorCode','COLLECTION_EXPIRED')
      WHERE id IN (SELECT a.id FROM account_insights a
        WHERE json_extract(a.payload_json,'$.status')='running'
          AND json_extract(a.payload_json,'$.requestedAt')<=?
          AND NOT EXISTS (SELECT 1 FROM collection_jobs j WHERE
            j.status='running' AND j.account_id=a.account_id AND j.lease_expires_at>?
            AND j.origin IN ('activity','audience')) LIMIT 100)
        AND json_extract(payload_json,'$.status')='running'`)
      .bind(now - 900_000, now)
      .run();
    return result.meta.changes;
  }
  async collection(id: string) {
    const row = (
      await this.db.select().from(accountInsights).where(eq(accountInsights.id, id)).limit(1)
    )[0];
    return row ? (JSON.parse(row.payloadJson) as InsightCollection) : null;
  }
  async reserve(collection: InsightCollection) {
    const result = await this.db
      .insert(accountInsights)
      .values({
        id: collection.id,
        accountId: collection.accountId,
        signature: collection.periodKey ?? JSON.stringify(collection.input),
        observedAt: collection.requestedAt,
        payloadJson: JSON.stringify(collection),
      })
      .onConflictDoUpdate({
        target: accountInsights.id,
        set: { observedAt: collection.requestedAt, payloadJson: JSON.stringify(collection) },
        where: sql`json_extract(${accountInsights.payloadJson}, '$.status')='failed'`,
      })
      .returning({ id: accountInsights.id });
    return result.length === 1;
  }
  async finish(collection: InsightCollection) {
    const rows = await this.db
      .update(accountInsights)
      .set({
        observedAt: collection.observedAt ?? collection.requestedAt,
        payloadJson: JSON.stringify(collection),
      })
      .where(
        and(
          eq(accountInsights.id, collection.id),
          sql`json_extract(${accountInsights.payloadJson}, '$.requestedAt')=${collection.requestedAt}`,
          sql`json_extract(${accountInsights.payloadJson}, '$.status')='running'`,
        ),
      )
      .returning({ id: accountInsights.id });
    return rows.length > 0;
  }
  async observations(
    accountId: string,
    kind: string,
    limit: number,
    selection: InsightSelection = {},
  ) {
    const field = (name: string) =>
      sql`json_extract(${accountInsights.payloadJson}, ${`$.input.${name}`})`;
    const period = selection.period;
    const cursor = selection.cursor;
    const rows = await this.db
      .select()
      .from(accountInsights)
      .where(
        and(
          eq(accountInsights.accountId, accountId),
          sql`json_extract(${accountInsights.payloadJson}, '$.input.kind') = ${kind}`,
          sql`json_extract(${accountInsights.payloadJson}, '$.status') = 'completed'`,
          period
            ? and(
                sql`${field("from")} = ${period.from}`,
                sql`${field("to")} = ${period.to}`,
                sql`${field("timeZone")} = ${period.timeZone}`,
                sql`${field("metricType")} = ${period.metricType}`,
                sql`coalesce(${field("breakdown")}, '') = ${period.breakdown ?? ""}`,
              )
            : undefined,
          selection.timeframe ? sql`${field("timeframe")} = ${selection.timeframe}` : undefined,
          selection.breakdown ? sql`${field("breakdown")} = ${selection.breakdown}` : undefined,
          cursor
            ? or(
                lt(accountInsights.observedAt, cursor.observedAt),
                and(
                  eq(accountInsights.observedAt, cursor.observedAt),
                  lt(accountInsights.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(accountInsights.observedAt), desc(accountInsights.id))
      .limit(limit + 1);
    return rows.map((row) => JSON.parse(row.payloadJson) as InsightCollection);
  }
}
