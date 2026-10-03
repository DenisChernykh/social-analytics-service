import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { commentCollections, comments } from "../../../platform/database/schema";
import type { CommentStore } from "../application/ports";
import type { CommentCollection, SavedComment } from "../domain/model";

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
        resultJson: JSON.stringify(collection),
      })
      .onConflictDoNothing()
      .returning({ id: commentCollections.id });
    return result.length === 1;
  }
  async finish(collection: CommentCollection, items: SavedComment[]) {
    await this.database.batch([
      ...items.map((item) =>
        this.database
          .prepare(
            "INSERT INTO comments (id,media_id,parent_id,text,published_at,observed_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM comment_collections WHERE id=?) ON CONFLICT(id) DO UPDATE SET parent_id=COALESCE(excluded.parent_id,comments.parent_id),text=excluded.text,observed_at=excluded.observed_at WHERE comments.media_id=excluded.media_id AND comments.observed_at<=excluded.observed_at",
          )
          .bind(
            item.id,
            item.mediaId,
            item.parentId,
            item.text,
            item.publishedAt,
            item.observedAt,
            collection.id,
          ),
      ),
      this.database
        .prepare("UPDATE comment_collections SET result_json=?,observed_at=? WHERE id=?")
        .bind(
          JSON.stringify(collection),
          collection.observedAt ?? collection.startedAt,
          collection.id,
        ),
    ]);
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
    ]);
  }
}
