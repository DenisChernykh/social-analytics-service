import { and, desc, eq, getTableColumns, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  accountSnapshots,
  accounts,
  mediaSnapshots,
  media as mediaTable,
  syncRuns,
} from "../../../platform/database/schema";
import { ApplicationError } from "../../../shared/application/application-error";
import type { AccountHistoryInput, AnalyticsRepository, MediaFilter } from "../application/ports";
import { metricDefinitions } from "../domain/metric-definitions";
import type { Account, Media, Metrics, Snapshot, SyncRun } from "../domain/model";
import { type FieldFreshness, type MetricKey, metricKeys } from "../domain/model";
import { normalizeSearch } from "../domain/search";

type Cursor = { time: number; id: string; rank?: number; filter?: string };
function encodeCursor(cursor: Cursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
      ),
    ) as Cursor;
    if (
      !Number.isSafeInteger(cursor.time) ||
      typeof cursor.id !== "string" ||
      cursor.id.length > 200
    )
      throw new Error("Invalid cursor");
    return cursor;
  } catch {
    throw new ApplicationError("VALIDATION_FAILED", "The pagination cursor is invalid.");
  }
}
function mapMedia(row: typeof mediaTable.$inferSelect): Media {
  return {
    id: row.id,
    accountId: row.accountId,
    externalId: row.externalId,
    caption: row.caption,
    title: row.title,
    mediaType: row.mediaType as Media["mediaType"],
    productType: row.productType,
    permalink: row.permalink,
    publishedAt: row.publishedAt,
    durationSeconds: row.durationSeconds,
    durationSource: row.durationSource as Media["durationSource"],
    context: row.contextJson ? JSON.parse(row.contextJson) : null,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
    firstDiscoveredAt: row.firstDiscoveredAt,
    discoverySource: row.discoverySource as Media["discoverySource"],
    availability: { unavailableUntil: row.unavailableUntil, errorCode: row.unavailableCode },
  };
}
function mapSnapshot(row: typeof mediaSnapshots.$inferSelect): Snapshot {
  return {
    id: row.id,
    mediaId: row.mediaId,
    observedAt: row.observedAt,
    apiVersion: row.apiVersion,
    provenance: row.provenanceJson ? JSON.parse(row.provenanceJson) : null,
    metrics: JSON.parse(row.metricsJson) as Metrics,
    storyInsights: row.storyInsightsJson ? JSON.parse(row.storyInsightsJson) : null,
    profileActivity: row.profileActivityJson ? JSON.parse(row.profileActivityJson) : null,
  };
}

export class D1Analytics implements AnalyticsRepository {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async accounts() {
    return (await this.db.select().from(accounts).orderBy(accounts.username)) as Account[];
  }
  async account(id: string) {
    return (
      ((await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1))[0] as
        | Account
        | undefined) ?? null
    );
  }
  async media(id: string) {
    const row = (await this.db.select().from(mediaTable).where(eq(mediaTable.id, id)).limit(1))[0];
    return row ? mapMedia(row) : null;
  }
  async selectedMedia(ids: string[]) {
    const result: Media[] = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const rows = await this.db
        .select()
        .from(mediaTable)
        .where(inArray(mediaTable.id, ids.slice(offset, offset + 50)));
      result.push(...rows.map(mapMedia));
    }
    return result;
  }
  async search(filter: MediaFilter) {
    const cursor = decodeCursor(filter.cursor);
    const words = JSON.stringify(filter.words);
    const phrase = normalizeSearch(filter.query ?? "");
    const signature = JSON.stringify([
      phrase,
      filter.accountId,
      filter.productType,
      filter.from,
      filter.to,
      filter.exactTitle,
      filter.rubric,
      filter.goal,
      filter.format,
    ]);
    if (cursor && (cursor.filter !== signature || !Number.isInteger(cursor.rank)))
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Continue pagination with the same search filters.",
      );
    const rank = filter.words.length
      ? sql<number>`CASE WHEN ${mediaTable.titleSearch} = ${phrase} OR rtrim(${mediaTable.permalink}, '/') = ${filter.query?.trim().replace(/\/$/, "") ?? ""} THEN 0 WHEN NOT EXISTS (SELECT 1 FROM json_each(${words}) w WHERE instr(' ' || ${mediaTable.searchText} || ' ', ' ' || w.value || ' ') = 0 AND instr(' ' || ${mediaTable.titleSearch} || ' ', ' ' || w.value || ' ') = 0) THEN 1 ELSE 2 END`
      : sql<number>`CASE WHEN 1 THEN 0 END`;
    const conditions = [
      sql`NOT EXISTS (SELECT 1 FROM json_each(${words}) w WHERE instr(${mediaTable.searchText}, w.value) = 0 AND instr(${mediaTable.titleSearch}, w.value) = 0)`,
    ];
    if (filter.exactTitle !== undefined)
      conditions.push(eq(mediaTable.titleSearch, filter.exactTitle));
    for (const key of ["rubric", "goal", "format"] as const)
      if (filter[key])
        conditions.push(
          sql`json_extract(${mediaTable.contextJson}, ${`$.confirmed.${key}`}) = ${filter[key]}`,
        );
    if (filter.accountId) conditions.push(eq(mediaTable.accountId, filter.accountId));
    if (filter.productType) conditions.push(eq(mediaTable.productType, filter.productType));
    if (filter.from !== undefined) conditions.push(gte(mediaTable.publishedAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(mediaTable.publishedAt, filter.to));
    if (cursor)
      conditions.push(
        sql`(${rank} > ${cursor.rank} OR (${rank} = ${cursor.rank} AND (${mediaTable.publishedAt} < ${cursor.time} OR (${mediaTable.publishedAt} = ${cursor.time} AND ${mediaTable.id} < ${cursor.id}))))`,
      );
    const rows = await this.db
      .select({ ...getTableColumns(mediaTable), relevance: rank })
      .from(mediaTable)
      .where(and(...conditions))
      .orderBy(rank, desc(mediaTable.publishedAt), desc(mediaTable.id))
      .limit(filter.limit + 1);
    const items = rows.slice(0, filter.limit).map(mapMedia);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > filter.limit && last
          ? encodeCursor({
              time: last.publishedAt,
              id: last.id,
              rank: rows[filter.limit - 1]?.relevance ?? 0,
              filter: signature,
            })
          : null,
    };
  }
  async snapshots(mediaId: string, limit: number) {
    return (
      await this.db
        .select()
        .from(mediaSnapshots)
        .where(eq(mediaSnapshots.mediaId, mediaId))
        .orderBy(desc(mediaSnapshots.observedAt), desc(mediaSnapshots.id))
        .limit(limit)
    ).map(mapSnapshot);
  }
  async metricFreshness(mediaId: string) {
    const result = Object.fromEntries(
      metricKeys.map((key) => [
        key,
        { lastAttempt: null, lastKnownGood: null, currentReason: null },
      ]),
    ) as Record<MetricKey, FieldFreshness>;
    const good = await this.database
      .prepare(`WITH f AS (
      SELECT s.observed_at,j.key metric,j.value payload,row_number() OVER(PARTITION BY j.key ORDER BY s.observed_at DESC,s.id DESC) rn
      FROM media_snapshots s,json_each(s.metrics_json) j WHERE s.media_id=? AND json_extract(j.value,'$.value') IS NOT NULL)
      SELECT * FROM f WHERE rn=1`)
      .bind(mediaId)
      .all<{ observed_at: number; metric: MetricKey; payload: string }>();
    for (const row of good.results) {
      const metric = JSON.parse(row.payload);
      if (result[row.metric])
        result[row.metric].lastKnownGood = {
          value: metric.value,
          observedAt: metric.provenance?.responseReceivedAt ?? row.observed_at,
          receiptId: metric.provenance?.receiptId ?? null,
          definitionVersion: metric.provenance?.definitionVersion ?? null,
          sourceField: metric.sourceField,
          unit: metric.unit,
        };
    }
    const wanted = metricKeys.map((key) => ({
      key,
      field: metricDefinitions[key].field,
      metadataField: key === "likes" ? "like_count" : key === "comments" ? "comments_count" : null,
    }));
    const attempts = await this.database
      .prepare(`WITH matched AS (
      SELECT json_extract(w.value,'$.key') metric,a.payload_json,row_number() OVER(PARTITION BY w.key ORDER BY a.requested_at DESC,a.id DESC) rn
      FROM instagram_http_attempts a JOIN media m ON a.account_id=m.account_id AND a.object_id=m.external_id CROSS JOIN json_each(?) w
      WHERE m.id=? AND (instr(','||COALESCE(json_extract(a.payload_json,'$.parameters.metric'),'')||',',','||json_extract(w.value,'$.field')||',')>0
        OR (json_extract(w.value,'$.metadataField') IS NOT NULL AND instr(','||COALESCE(json_extract(a.payload_json,'$.parameters.fields'),'')||',',','||json_extract(w.value,'$.metadataField')||',')>0)))
      SELECT metric,payload_json FROM matched WHERE rn=1`)
      .bind(JSON.stringify(wanted), mediaId)
      .all<{ metric: MetricKey; payload_json: string }>();
    for (const row of attempts.results) {
      const attempt = JSON.parse(row.payload_json);
      result[row.metric].lastAttempt = {
        receiptId: attempt.id,
        requestStartedAt: attempt.requestStartedAt,
        responseReceivedAt: attempt.responseReceivedAt,
        failedAt: attempt.failedAt,
        status: attempt.result,
        httpStatus: attempt.httpStatus,
        graphCode: attempt.graphCode,
        graphSubcode: attempt.graphSubcode,
      };
    }
    const latest = (await this.snapshots(mediaId, 1))[0];
    for (const key of metricKeys) {
      const field = result[key];
      field.currentReason = latest?.metrics[key].reason ?? (latest ? null : "not_collected");
      if (
        field.lastAttempt &&
        !["success", "not_supported"].includes(field.lastAttempt.status) &&
        field.lastAttempt.requestStartedAt > (field.lastKnownGood?.observedAt ?? 0)
      )
        field.currentReason = field.lastAttempt.status;
    }
    return result;
  }
  async latest(mediaIds: string[]) {
    const result = new Map<string, Snapshot>();
    for (let start = 0; start < mediaIds.length; start += 50) {
      const ids = mediaIds.slice(start, start + 50);
      const rows = await this.db
        .select()
        .from(mediaSnapshots)
        .where(
          and(
            inArray(mediaSnapshots.mediaId, ids),
            sql`not exists (
        select 1 from media_snapshots newer where newer.media_id = ${mediaSnapshots.mediaId}
        and (newer.observed_at > ${mediaSnapshots.observedAt} or (newer.observed_at = ${mediaSnapshots.observedAt} and newer.id > ${mediaSnapshots.id}))
      )`,
          ),
        );
      for (const row of rows) result.set(row.mediaId, mapSnapshot(row));
    }
    return result;
  }
  async history(
    mediaId: string,
    from: number | undefined,
    to: number | undefined,
    value: string | undefined,
    limit: number,
  ) {
    const cursor = decodeCursor(value);
    const conditions = [eq(mediaSnapshots.mediaId, mediaId)];
    if (from !== undefined) conditions.push(gte(mediaSnapshots.observedAt, from));
    if (to !== undefined) conditions.push(lte(mediaSnapshots.observedAt, to));
    if (cursor)
      conditions.push(
        or(
          lt(mediaSnapshots.observedAt, cursor.time),
          and(eq(mediaSnapshots.observedAt, cursor.time), lt(mediaSnapshots.id, cursor.id)),
        ) as NonNullable<(typeof conditions)[number]>,
      );
    const rows = await this.db
      .select()
      .from(mediaSnapshots)
      .where(and(...conditions))
      .orderBy(desc(mediaSnapshots.observedAt), desc(mediaSnapshots.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(mapSnapshot);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last ? encodeCursor({ time: last.observedAt, id: last.id }) : null,
    };
  }
  async atAge(
    mediaIds: string[],
    ageDays: number,
    selection?: { metric: MetricKey; denominator?: "reach" | "views" },
  ) {
    const result = new Map<string, Snapshot>();
    const pair = selection?.denominator
      ? (() => {
          const x = `$.${selection.metric}`,
            y = `$.${selection.denominator}`;
          const get = (path: string) => `json_extract(s.metrics_json,'${path}')`;
          const equal = ["definitionVersion", "login", "requestedApiVersion", "surface"]
            .map((k) => `${get(`${x}.provenance.${k}`)} IS ${get(`${y}.provenance.${k}`)}`)
            .join(" AND ");
          const d1 = get(`${x}.provenance.distribution`),
            d2 = get(`${y}.provenance.distribution`),
            v1 = get(`${x}.provenance.actualApiVersion`),
            v2 = get(`${y}.provenance.actualApiVersion`);
          return ` AND ${get(`${x}.unit`)}=${get(`${y}.unit`)} AND ((${get(`${x}.provenance`)} IS NULL AND ${get(`${y}.provenance`)} IS NULL) OR (${get(`${x}.provenance`)} IS NOT NULL AND ${get(`${y}.provenance`)} IS NOT NULL AND ${equal} AND (${d1}=${d2} OR ${d1}='unknown' OR ${d2}='unknown') AND (${v1} IS NULL OR ${v2} IS NULL OR ${v1}=${v2}) AND abs(${get(`${x}.provenance.responseReceivedAt`)}-${get(`${y}.provenance.responseReceivedAt`)})<=60000))`;
        })()
      : "";
    const tolerance = (ageDays === 1 ? 6 : ageDays === 7 ? 12 : 24) * 3_600_000;
    for (let offset = 0; offset < mediaIds.length; offset += 40) {
      const ids = mediaIds.slice(offset, offset + 40);
      const rows = await this.database
        .prepare(
          `SELECT * FROM (SELECT s.*, row_number() OVER (PARTITION BY s.media_id ORDER BY abs(s.observed_at-m.published_at-?),s.observed_at,s.id) AS position FROM media_snapshots s JOIN media m ON m.id=s.media_id WHERE m.id IN (${ids.map(() => "?").join(",")}) AND abs(s.observed_at-m.published_at-?)<=? ${selection ? `AND json_extract(s.metrics_json,'$.${selection.metric}.value') IS NOT NULL ${selection.denominator ? `AND json_extract(s.metrics_json,'$.${selection.denominator}.value')>0 ${pair}` : ""}` : ""}) WHERE position=1`,
        )
        .bind(ageDays * 86_400_000, ...ids, ageDays * 86_400_000, tolerance)
        .all<{
          id: string;
          media_id: string;
          observed_at: number;
          api_version: string;
          metrics_json: string;
          story_insights_json: string | null;
          profile_activity_json: string | null;
          provenance_json: string | null;
        }>();
      for (const row of rows.results)
        result.set(row.media_id, {
          id: row.id,
          mediaId: row.media_id,
          observedAt: row.observed_at,
          apiVersion: row.api_version,
          provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null,
          metrics: JSON.parse(row.metrics_json),
          storyInsights: row.story_insights_json ? JSON.parse(row.story_insights_json) : null,
          profileActivity: row.profile_activity_json ? JSON.parse(row.profile_activity_json) : null,
        });
    }
    return result;
  }
  async accountHistory(accountId: string, input: AccountHistoryInput) {
    const cursor = decodeCursor(input.cursor);
    const signature = JSON.stringify([accountId, input.from, input.to]);
    if (cursor && cursor.filter !== signature)
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "Continue account history with the same account and date filters.",
      );
    const conditions = [eq(accountSnapshots.accountId, accountId)];
    if (input.from !== undefined) conditions.push(gte(accountSnapshots.observedAt, input.from));
    if (input.to !== undefined) conditions.push(lte(accountSnapshots.observedAt, input.to));
    const pageConditions = [...conditions];
    if (cursor)
      pageConditions.push(
        sql`(${accountSnapshots.observedAt}<${cursor.time} OR (${accountSnapshots.observedAt}=${cursor.time} AND ${accountSnapshots.id}<${cursor.id}))`,
      );
    const rows = await this.db
      .select()
      .from(accountSnapshots)
      .where(and(...pageConditions))
      .orderBy(desc(accountSnapshots.observedAt), desc(accountSnapshots.id))
      .limit(input.limit + 1);
    const [count, firstRows, lastRows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(accountSnapshots)
        .where(and(...conditions)),
      this.db
        .select()
        .from(accountSnapshots)
        .where(and(...conditions))
        .orderBy(accountSnapshots.observedAt, accountSnapshots.id)
        .limit(1),
      this.db
        .select()
        .from(accountSnapshots)
        .where(and(...conditions))
        .orderBy(desc(accountSnapshots.observedAt), desc(accountSnapshots.id))
        .limit(1),
    ]);
    const map = (row: typeof accountSnapshots.$inferSelect) => ({
      observedAt: row.observedAt,
      followersCount: row.followersCount,
      mediaCount: row.mediaCount,
      provenance: row.provenanceJson ? JSON.parse(row.provenanceJson) : null,
    });
    const last = rows[input.limit - 1];
    return {
      items: rows.slice(0, input.limit).map(map),
      nextCursor:
        rows.length > input.limit && last
          ? encodeCursor({ time: last.observedAt, id: last.id, filter: signature })
          : null,
      totalObservations: count[0]?.total ?? 0,
      first: firstRows[0] ? map(firstRows[0]) : null,
      last: lastRows[0] ? map(lastRows[0]) : null,
    };
  }
  async updateMedia(
    id: string,
    input: { title?: string | null; durationSeconds?: number | null },
    now: number,
  ) {
    await this.db
      .update(mediaTable)
      .set({
        updatedAt: now,
        ...(input.title !== undefined
          ? { title: input.title, titleSearch: normalizeSearch(input.title ?? "") }
          : {}),
        ...(input.durationSeconds !== undefined
          ? {
              durationSeconds: input.durationSeconds,
              durationSource: input.durationSeconds === null ? null : "manual",
            }
          : {}),
      })
      .where(eq(mediaTable.id, id));
  }
  async run(id: string) {
    return (
      ((await this.db.select().from(syncRuns).where(eq(syncRuns.id, id)).limit(1))[0] as
        | SyncRun
        | undefined) ?? null
    );
  }
  async begin(run: SyncRun, leaseExpiresAt: number) {
    const result = await this.database
      .prepare(`INSERT INTO sync_leases (account_id,run_id,expires_at) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET run_id=excluded.run_id,expires_at=excluded.expires_at
      WHERE sync_leases.expires_at <= ?`)
      .bind(run.accountId, run.id, leaseExpiresAt, run.startedAt)
      .run();
    if (result.meta.changes !== 1) return false;
    await this.db.batch([
      this.db
        .update(syncRuns)
        .set({ status: "failed", completedAt: run.startedAt, errorCode: "SYNC_LEASE_EXPIRED" })
        .where(
          and(
            eq(syncRuns.accountId, run.accountId),
            eq(syncRuns.status, "running"),
            lte(syncRuns.leaseExpiresAt, run.startedAt),
          ),
        ),
      this.db
        .insert(syncRuns)
        .values({ ...run, leaseExpiresAt })
        .onConflictDoUpdate({
          target: syncRuns.id,
          set: { ...run, leaseExpiresAt },
          where: eq(syncRuns.status, "failed"),
        }),
    ]);
    return true;
  }
  async finish(
    run: SyncRun,
    profile: {
      observedAt?: number;
      receipt?: import("../../instagram/public-contracts").ReceiptReference;
      username: string;
      accountType: string;
      followersCount: number | null;
      mediaCount: number | null;
    },
    items: Array<{ media: Media; snapshot: Snapshot }>,
    now: number,
  ) {
    const guard =
      "EXISTS (SELECT 1 FROM sync_leases l JOIN sync_runs r ON r.id=l.run_id WHERE l.account_id=? AND l.run_id=? AND l.expires_at>? AND r.started_at=? AND r.status='running')";
    const fence = [run.accountId, run.id, now, run.startedAt];
    const statements: D1PreparedStatement[] = [];
    for (const item of items) {
      const media = item.media;
      statements.push(
        this.database
          .prepare(`INSERT INTO media (id,account_id,external_id,caption,search_text,media_type,product_type,permalink,published_at,updated_at,metadata_json,first_discovered_at,discovery_source,unavailable_until,unavailable_code)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET caption=excluded.caption,search_text=excluded.search_text,media_type=excluded.media_type,
        product_type=excluded.product_type,permalink=excluded.permalink,published_at=excluded.published_at,updated_at=excluded.updated_at,
        metadata_json=COALESCE(excluded.metadata_json,media.metadata_json),unavailable_until=excluded.unavailable_until,unavailable_code=excluded.unavailable_code`)
          .bind(
            media.id,
            media.accountId,
            media.externalId,
            media.caption,
            normalizeSearch(`${media.caption} ${media.permalink}`),
            media.mediaType,
            media.productType,
            media.permalink,
            media.publishedAt,
            now,
            media.metadata ? JSON.stringify(media.metadata) : null,
            media.firstDiscoveredAt ?? now,
            media.discoverySource ?? "collection",
            media.availability?.unavailableUntil ?? 0,
            media.availability?.errorCode ?? null,
            ...fence,
          ),
      );
      const snapshot = item.snapshot;
      statements.push(
        this.database
          .prepare(`INSERT INTO media_snapshots (id,media_id,observed_at,api_version,metrics_json,story_insights_json,profile_activity_json,operation_id,provenance_json)
        SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
          .bind(
            snapshot.id,
            snapshot.mediaId,
            snapshot.observedAt,
            snapshot.apiVersion,
            JSON.stringify(snapshot.metrics),
            snapshot.storyInsights ? JSON.stringify(snapshot.storyInsights) : null,
            snapshot.profileActivity ? JSON.stringify(snapshot.profileActivity) : null,
            run.id,
            snapshot.provenance ? JSON.stringify(snapshot.provenance) : null,
            ...fence,
          ),
      );
    }
    statements.push(
      this.database
        .prepare(`INSERT INTO account_snapshots (id,account_id,observed_at,followers_count,media_count,provenance_json)
      SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
        .bind(
          run.id,
          run.accountId,
          profile.observedAt ?? now,
          profile.followersCount,
          profile.mediaCount,
          profile.receipt ? JSON.stringify(profile.receipt) : null,
          ...fence,
        ),
    );
    statements.push(
      this.database
        .prepare(
          `UPDATE accounts SET username=?,account_type=?,last_synced_at=? WHERE id=? AND ${guard}`,
        )
        .bind(profile.username, profile.accountType, now, run.accountId, ...fence),
    );
    const completedIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `UPDATE sync_runs SET status='completed',completed_at=?,next_cursor=?,media_count=?,useful_values=?,coverage_state=?,first_useful_at=?,last_useful_at=? WHERE id=? AND ${guard}`,
        )
        .bind(
          now,
          run.nextCursor,
          run.mediaCount,
          run.usefulValues ?? null,
          run.coverageState ?? null,
          run.firstUsefulAt ?? null,
          run.lastUsefulAt ?? null,
          run.id,
          ...fence,
        ),
    );
    statements.push(
      this.database
        .prepare(
          "DELETE FROM sync_leases WHERE account_id=? AND run_id=? AND EXISTS (SELECT 1 FROM sync_runs WHERE id=? AND started_at=?)",
        )
        .bind(run.accountId, run.id, run.id, run.startedAt),
    );
    const results = await this.database.batch(statements);
    if (results[completedIndex]?.meta.changes !== 1)
      throw new ApplicationError(
        "SYNC_IN_PROGRESS",
        "The sync lease expired; start a new sync operation.",
      );
  }
  async fail(run: SyncRun, code: string, now: number) {
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE sync_runs SET status='failed',completed_at=?,error_code=? WHERE id=? AND account_id=? AND status='running' AND started_at=?",
        )
        .bind(now, code, run.id, run.accountId, run.startedAt),
      this.database
        .prepare(
          "DELETE FROM sync_leases WHERE account_id=? AND run_id=? AND EXISTS (SELECT 1 FROM sync_runs WHERE id=? AND started_at=?)",
        )
        .bind(run.accountId, run.id, run.id, run.startedAt),
    ]);
  }
}
