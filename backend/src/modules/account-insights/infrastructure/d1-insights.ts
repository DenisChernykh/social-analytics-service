import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { accountInsights } from "../../../platform/database/schema";
import type { InsightSelection, InsightStore } from "../application/ports";
import type { InsightCollection } from "../domain/model";

export class D1Insights implements InsightStore {
  private readonly db;
  constructor(database: D1Database) {
    this.db = drizzle(database);
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
        signature: JSON.stringify(collection.input),
        observedAt: collection.requestedAt,
        payloadJson: JSON.stringify(collection),
      })
      .onConflictDoNothing()
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
      .where(eq(accountInsights.id, collection.id));
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
