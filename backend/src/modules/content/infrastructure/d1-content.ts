import { desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  businessRecords,
  experiments,
  media,
  storySequences,
} from "../../../platform/database/schema";
import { ApplicationError } from "../../../shared/application/application-error";
import type { ContentContext } from "../../../shared/domain/content";
import type { ContentStore } from "../application/ports";
import type { BusinessRecord, Experiment, StorySequence } from "../domain/model";

export class D1Content implements ContentStore {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }
  async contexts(ids: string[]) {
    const rows = await this.db
      .select({ id: media.id, context: media.contextJson })
      .from(media)
      .where(inArray(media.id, ids));
    return new Map(
      rows
        .filter((row) => row.context)
        .map((row) => [row.id, JSON.parse(row.context as string) as ContentContext]),
    );
  }
  async setContexts(contexts: Map<string, ContentContext>) {
    if (!contexts.size) return;
    const payload = JSON.stringify([...contexts].map(([id, context]) => ({ id, context })));
    await this.database
      .prepare(
        "UPDATE media SET context_json=(SELECT json_extract(item.value,'$.context') FROM json_each(?) item WHERE json_extract(item.value,'$.id')=media.id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
      )
      .bind(payload, payload)
      .run();
  }
  async businessRecords(ids: string[]) {
    if (!ids.length) return [];
    const result: BusinessRecord[] = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const rows = await this.db
        .select()
        .from(businessRecords)
        .where(inArray(businessRecords.mediaId, ids.slice(offset, offset + 50)))
        .orderBy(businessRecords.recordedAt);
      result.push(
        ...rows.map((row) => ({
          ...(JSON.parse(row.payloadJson) as BusinessRecord),
          recordedAt: row.recordedAt,
        })),
      );
    }
    return result;
  }
  async importRecords(records: BusinessRecord[], now: number) {
    if (!records.length) return;
    const payload = JSON.stringify(records);
    const result = await this.database
      .prepare(`INSERT INTO business_records (id,media_id,recorded_at,payload_json)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.mediaId'),?,value FROM json_each(?)
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?) incoming JOIN business_records stored ON stored.id=json_extract(incoming.value,'$.id')
        WHERE stored.media_id<>json_extract(incoming.value,'$.mediaId') OR json_extract(stored.payload_json,'$.source')<>json_extract(incoming.value,'$.source')
      )
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,recorded_at=excluded.recorded_at`)
      .bind(now, payload, payload)
      .run();
    if (result.meta.changes !== records.length)
      throw new ApplicationError(
        "OPERATION_CONFLICT",
        "A record correction must retain its publication and original source. No records were changed.",
      );
  }
  async experiment(id: string) {
    const row = (
      await this.db.select().from(experiments).where(eq(experiments.id, id)).limit(1)
    )[0];
    return row
      ? ({
          id: row.id,
          accountId: row.accountId,
          createdAt: row.createdAt,
          plan: JSON.parse(row.planJson),
          assignments: JSON.parse(row.assignmentsJson),
          conclusion: row.conclusionJson ? JSON.parse(row.conclusionJson) : null,
        } as Experiment)
      : null;
  }
  async experiments(accountId: string) {
    const rows = await this.db
      .select()
      .from(experiments)
      .where(eq(experiments.accountId, accountId))
      .orderBy(desc(experiments.createdAt))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      createdAt: row.createdAt,
      plan: JSON.parse(row.planJson),
      assignments: JSON.parse(row.assignmentsJson),
      conclusion: row.conclusionJson ? JSON.parse(row.conclusionJson) : null,
    })) as Experiment[];
  }
  async saveExperiment(experiment: Experiment) {
    await this.db
      .insert(experiments)
      .values({
        id: experiment.id,
        accountId: experiment.accountId,
        createdAt: experiment.createdAt,
        planJson: JSON.stringify(experiment.plan),
        assignmentsJson: JSON.stringify(experiment.assignments),
        conclusionJson: experiment.conclusion ? JSON.stringify(experiment.conclusion) : null,
      })
      .onConflictDoUpdate({
        target: experiments.id,
        set: {
          assignmentsJson: JSON.stringify(experiment.assignments),
          conclusionJson: experiment.conclusion ? JSON.stringify(experiment.conclusion) : null,
        },
      });
  }
  async sequence(id: string) {
    const row = (
      await this.db.select().from(storySequences).where(eq(storySequences.id, id)).limit(1)
    )[0];
    return row ? (JSON.parse(row.payloadJson) as StorySequence) : null;
  }
  async saveSequence(sequence: StorySequence) {
    await this.db
      .insert(storySequences)
      .values({
        id: sequence.id,
        accountId: sequence.accountId,
        updatedAt: sequence.updatedAt,
        payloadJson: JSON.stringify(sequence),
      })
      .onConflictDoUpdate({
        target: storySequences.id,
        set: { payloadJson: JSON.stringify(sequence), updatedAt: sequence.updatedAt },
      });
  }
}
