// Source requests also persist quota/receipt data in D1. Keep portions small
// enough for Free-plan D1 queries and leave time to save the checkpoint.
// Throughput comes from the next alarm, not a larger atomic operation.
export const collectionExecution = {
  maximumHttpAttempts: 6,
  workBudgetMs: 90_000,
  persistenceReserveMs: 15_000,
  pageSize: 1,
  continuationDelayMs: 1000,
  idleCheckMs: 60_000,
} as const;
