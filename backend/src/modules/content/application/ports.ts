import type { ContentContext } from "../../../shared/domain/content";
import type { Media, MediaFilter, Snapshot } from "../../analytics/public-contracts";
import type { BusinessRecord, Experiment, StorySequence } from "../domain/model";

export interface ContentStore {
  contexts(ids: string[]): Promise<Map<string, ContentContext>>;
  setContexts(contexts: Map<string, ContentContext>): Promise<void>;
  businessRecords(ids: string[]): Promise<BusinessRecord[]>;
  importRecords(records: BusinessRecord[], now: number): Promise<void>;
  experiment(id: string): Promise<Experiment | null>;
  experiments(accountId: string): Promise<Experiment[]>;
  saveExperiment(experiment: Experiment): Promise<void>;
  sequence(id: string): Promise<StorySequence | null>;
  saveSequence(sequence: StorySequence): Promise<void>;
}
export interface ContentAnalytics {
  account(id: string): Promise<unknown>;
  media(id: string): Promise<Media>;
  selection(ids: string[]): Promise<Map<string, Media>>;
  search(
    filter: Omit<MediaFilter, "words">,
  ): Promise<{ items: Media[]; nextCursor: string | null }>;
  snapshots(
    ids: string[],
    ageDays?: number,
    selection?: {
      metric: import("../../analytics/public-contracts").MetricKey;
      denominator?: "reach" | "views";
    },
  ): Promise<Map<string, Snapshot>>;
  history(id: string): Promise<{ items: Snapshot[]; truncated: boolean }>;
}
