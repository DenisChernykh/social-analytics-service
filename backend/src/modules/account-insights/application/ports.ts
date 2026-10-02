import type { InsightCollection, InsightInput, InsightValue } from "../domain/model";

export type InsightSelection = {
  cursor?: { observedAt: number; id: string };
  period?: {
    from: number;
    to: number;
    timeZone: string;
    metricType: string;
    breakdown?: string;
  };
  timeframe?: string;
  breakdown?: string;
};

export interface InsightStore {
  collection(id: string): Promise<InsightCollection | null>;
  reserve(collection: InsightCollection): Promise<boolean>;
  finish(collection: InsightCollection): Promise<void>;
  observations(
    accountId: string,
    kind: string,
    limit: number,
    selection?: InsightSelection,
  ): Promise<InsightCollection[]>;
}
export interface AccountInsightSource {
  account(accountId: string): Promise<{ externalId: string }>;
  read(accountId: string, input: InsightInput): Promise<InsightValue[]>;
}
