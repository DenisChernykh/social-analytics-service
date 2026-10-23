import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { accountInsights } from "../../../platform/database/schema";
import type { InsightSelection, InsightStore } from "../application/ports";
import { activityMetrics, type InsightCollection } from "../domain/model";
import type { PeriodObservation } from "../domain/periods";

export class D1Insights implements InsightStore {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async periodObservations(accountId: string, timeZone: string, apiVersion: string, since: number) {
    const result = await this.database
      .prepare(
        `SELECT json_extract(payload_json,'$.input.from') AS "from",json_extract(payload_json,'$.input.to') AS "to",MAX(observed_at) AS observedAt FROM account_insights
       WHERE account_id=? AND observed_at>=? AND json_extract(payload_json,'$.status')='completed'
         AND NOT EXISTS (SELECT 1 FROM json_each(payload_json,'$.values') v WHERE json_extract(v.value,'$.reason')='request_deferred')
         AND json_extract(payload_json,'$.apiVersion')=? AND json_extract(payload_json,'$.input.kind')='activity'
         AND json_extract(payload_json,'$.input.timeZone')=? AND json_extract(payload_json,'$.input.metricType')='total_value'
         AND json_extract(payload_json,'$.input.breakdown') IS NULL
         AND (SELECT COUNT(DISTINCT saved.value) FROM json_each(account_insights.payload_json,'$.input.metrics') saved
           WHERE saved.value IN (${activityMetrics.map(() => "?").join(",")}))=?
       GROUP BY json_extract(payload_json,'$.input.from'),json_extract(payload_json,'$.input.to')`,
      )
      .bind(accountId, since, apiVersion, timeZone, ...activityMetrics, activityMetrics.length)
      .all<PeriodObservation>();
    return result.results;
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
    await this.db
      .update(accountInsights)
      .set({
        observedAt: collection.observedAt ?? collection.requestedAt,
        payloadJson: JSON.stringify(collection),
      })
      .where(
        and(
          eq(accountInsights.id, collection.id),
          sql`json_extract(${accountInsights.payloadJson}, '$.requestedAt')=${collection.requestedAt}`,
        ),
      );
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
