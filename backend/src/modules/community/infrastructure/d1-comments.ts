import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  commentCollections,
  commentMediaState,
  comments,
  commentWebhookEvents,
} from "../../../platform/database/schema";
import type { CommentStore } from "../application/ports";
import type { CommentCollection, CommentOwnership, SavedComment } from "../domain/model";

export class D1Comments implements CommentStore {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async collection(id: string) {
    const row = (
      await this.db.select().from(commentCollections).where(eq(commentCollections.id, id)).limit(1)
    )[0];
    return row ? (JSON.parse(row.resultJson) as CommentCollection) : null;
  }
  async reserve(collection: CommentCollection) {
    const result = await this.db
      .insert(commentCollections)
      .values({
        id: collection.id,
        mediaId: collection.mediaId,
        signature: JSON.stringify([
          collection.mediaId,
          collection.parentId,
          collection.cursor,
          collection.limit,
        ]),
        observedAt: collection.startedAt,
        jobId: collection.jobId ?? null,
        parentId: collection.parentId,
        resultJson: JSON.stringify(collection),
      })
      .onConflictDoUpdate({
        target: commentCollections.id,
        set: { observedAt: collection.startedAt, resultJson: JSON.stringify(collection) },
        where: sql`json_extract(${commentCollections.resultJson}, '$.status')='failed'`,
      })
      .returning({ id: commentCollections.id });
    return result.length === 1;
  }
  async repeatedPage(collection: CommentCollection) {
    if (!collection.jobId || !collection.pageFingerprint) return false;
    return (
      (await this.database
        .prepare(
          "SELECT 1 FROM comment_collections WHERE media_id=? AND id!=? AND job_id=? AND parent_id IS ? AND page_fingerprint=? AND json_extract(result_json,'$.status')='completed' LIMIT 1",
        )
        .bind(
          collection.mediaId,
          collection.id,
          collection.jobId,
          collection.parentId,
          collection.pageFingerprint,
        )
        .first()) !== null
    );
  }
  async finish(
    collection: CommentCollection,
    items: SavedComment[],
    now: number,
    ownership?: CommentOwnership,
  ) {
    const fence = ownership
      ? " AND EXISTS (SELECT 1 FROM collection_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?)"
      : "";
    const fenceValues = ownership ? [ownership.jobId, ownership.leaseToken, now] : [];
    // A bounded JSON chunk keeps transport receipts plus the largest expansion
    // within D1's request/query limits. Fields and ownership remain explicit.
    const chunks: SavedComment[][] = [];
    for (let offset = 0; offset < items.length; offset += 25)
      chunks.push(items.slice(offset, offset + 25));
    const results = await this.database.batch([
      ...chunks.map((chunk) =>
        this.database
          .prepare(
            `INSERT INTO comments (id,media_id,parent_id,text,published_at,observed_at,author_id,author_username,like_count,hidden) SELECT json_extract(value,'$.id'),json_extract(value,'$.mediaId'),json_extract(value,'$.parentId'),json_extract(value,'$.text'),json_extract(value,'$.publishedAt'),json_extract(value,'$.observedAt'),json_extract(value,'$.authorId'),json_extract(value,'$.authorUsername'),json_extract(value,'$.likeCount'),json_extract(value,'$.hidden') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM comment_collections WHERE id=? AND json_extract(result_json,'$.startedAt')=?)${fence} ON CONFLICT(id) DO UPDATE SET parent_id=COALESCE(excluded.parent_id,comments.parent_id),text=excluded.text,observed_at=excluded.observed_at,author_id=excluded.author_id,author_username=excluded.author_username,like_count=excluded.like_count,hidden=excluded.hidden WHERE comments.media_id=excluded.media_id AND comments.observed_at<=excluded.observed_at`,
          )
          .bind(JSON.stringify(chunk), collection.id, collection.startedAt, ...fenceValues),
      ),
      this.database
        .prepare(
          `UPDATE comment_collections SET result_json=?,observed_at=?,job_id=?,parent_id=?,page_fingerprint=? WHERE id=? AND json_extract(result_json,'$.startedAt')=?${fence}`,
        )
        .bind(
          JSON.stringify(collection),
          collection.observedAt ?? collection.startedAt,
          collection.jobId ?? null,
          collection.parentId,
          collection.pageFingerprint ?? null,
          collection.id,
          collection.startedAt,
          ...fenceValues,
        ),
    ]);
    return (results.at(-1)?.meta.changes ?? 0) > 0;
  }
  async list(mediaId: string, cursor: { time: number; id: string } | null, limit: number) {
    return this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.mediaId, mediaId),
          cursor
            ? or(
                lt(comments.publishedAt, cursor.time),
                and(eq(comments.publishedAt, cursor.time), lt(comments.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(comments.publishedAt), desc(comments.id))
      .limit(limit + 1);
  }
  async comment(id: string) {
    return (await this.db.select().from(comments).where(eq(comments.id, id)).limit(1))[0] ?? null;
  }
  async rootCommentIds(mediaId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(eq(comments.mediaId, mediaId), inArray(comments.id, ids), isNull(comments.parentId)),
      );
    const roots = new Set(rows.map((row) => row.id));
    return [...new Set(ids)].filter((id) => roots.has(id));
  }
  async erase(mediaId: string) {
    await this.db.batch([
      this.db.delete(comments).where(eq(comments.mediaId, mediaId)),
      this.db.delete(commentCollections).where(eq(commentCollections.mediaId, mediaId)),
      this.db.delete(commentMediaState).where(eq(commentMediaState.mediaId, mediaId)),
      this.db.delete(commentWebhookEvents).where(eq(commentWebhookEvents.mediaId, mediaId)),
    ]);
  }
  async freshness(mediaId: string) {
    const count = await this.database
      .prepare("SELECT COUNT(*) AS total FROM comments WHERE media_id=?")
      .bind(mediaId)
      .first<{ total: number }>();
    const row = await this.database
      .prepare(
        "SELECT last_attempt_at AS lastAttemptAt,last_complete_at AS lastCompleteAt,next_refresh_at AS nextRefreshAt,omitted_branches AS omittedReplyBranches,error_code AS errorCode,unavailable_until AS unavailableUntil FROM comment_media_state WHERE media_id=?",
      )
      .bind(mediaId)
      .first<{
        lastAttemptAt: number | null;
        lastCompleteAt: number | null;
        nextRefreshAt: number;
        omittedReplyBranches: number;
        errorCode: string | null;
        unavailableUntil: number;
      }>();
    return {
      uniqueSaved: count?.total ?? 0,
      lastAttemptAt: row?.lastAttemptAt ?? null,
      lastCompleteAt: row?.lastCompleteAt ?? null,
      nextRefreshAt: row?.nextRefreshAt ?? null,
      omittedReplyBranches: row?.omittedReplyBranches ?? 0,
      errorCode: row?.errorCode ?? null,
      unavailableUntil: row?.unavailableUntil ?? 0,
    };
  }
}
