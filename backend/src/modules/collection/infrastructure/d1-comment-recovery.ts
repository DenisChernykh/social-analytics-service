export class D1CommentRecovery {
  constructor(private readonly database: D1Database) {}
  async queueIncomplete(now: number) {
    // Wait for pre-upgrade passes to finish before resetting their due time.
    const active = await this.database
      .prepare(
        "SELECT 1 FROM collection_jobs WHERE status='running' AND origin IN ('comments','comments_refresh') LIMIT 1",
      )
      .first();
    if (active) return false;
    await this.database
      .prepare(`UPDATE comment_media_state
      SET next_refresh_at=MIN(next_refresh_at,?)
      WHERE omitted_branches>0 AND EXISTS (SELECT 1 FROM media m
        JOIN collection_schedules s ON s.account_id=m.account_id
        WHERE m.id=comment_media_state.media_id AND s.enabled=1)`)
      .bind(now)
      .run();
    return true;
  }
}
