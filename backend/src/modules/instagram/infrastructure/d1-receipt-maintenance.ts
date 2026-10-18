const batchSize = 100;
const dayMs = 86_400_000;

export class D1ReceiptMaintenance {
  constructor(private readonly database: D1Database) {}

  async pruneReceipts(cutoffAt: number) {
    // Fixed cutoffs for a daily pass. Both searches are bounded by the
    // retention indexes; repeated execution after a crash is harmless.
    const results = await this.database.batch([
      this.database
        .prepare(
          "DELETE FROM instagram_http_attempts WHERE id IN (SELECT id FROM instagram_http_attempts WHERE requested_at<? LIMIT 100)",
        )
        .bind(cutoffAt - 30 * dayMs),
      this.database
        .prepare(
          "UPDATE instagram_http_attempts SET payload_json=json_set(payload_json,'$.sample',NULL) WHERE id IN (SELECT id FROM instagram_http_attempts WHERE requested_at<? AND json_extract(payload_json,'$.sample') IS NOT NULL LIMIT 100)",
        )
        .bind(cutoffAt - 7 * dayMs),
    ]);
    return { more: results.some((result) => result.meta.changes >= batchSize) };
  }
}
