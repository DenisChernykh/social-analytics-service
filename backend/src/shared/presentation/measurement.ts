import { z } from "@hono/zod-openapi";
export const receiptReferenceSchema = z.object({
  receiptId: z.string(),
  operationId: z.string().nullable(),
  requestStartedAt: z.number(),
  responseReceivedAt: z.number().nullable(),
  requestedApiVersion: z.string(),
  actualApiVersion: z.string().nullable(),
  login: z.literal("instagram_login"),
});
export const measurementProvenanceSchema = receiptReferenceSchema.extend({
  definitionVersion: z.string(),
  surface: z.enum(["instagram", "facebook", "combined", "unknown"]),
  distribution: z.enum(["organic", "includes_paid", "unknown"]),
});
export const observationProvenanceSchema = z.object({
  requestStartedAt: z.number(),
  responseReceivedAt: z.number(),
  receiptIds: z.array(z.string()),
  semantics: z.literal("sequential_requests_lifetime"),
  definitionVersion: z.string(),
});
export const fieldFreshnessSchema = z.object({
  lastAttempt: z
    .object({
      receiptId: z.string(),
      requestStartedAt: z.number(),
      responseReceivedAt: z.number().nullable(),
      failedAt: z.number().nullable(),
      status: z.string(),
      httpStatus: z.number().nullable(),
      graphCode: z.number().nullable(),
      graphSubcode: z.number().nullable(),
    })
    .nullable(),
  lastKnownGood: z
    .object({
      value: z.number(),
      observedAt: z.number(),
      receiptId: z.string().nullable(),
      definitionVersion: z.string().nullable(),
      sourceField: z.string(),
      unit: z.string(),
    })
    .nullable(),
  currentReason: z.string().nullable(),
});
export const windowCoverageSchema = z.object({
  targetHours: z.number(),
  toleranceHours: z.number(),
  metric: z.string().optional(),
  rankingMode: z.enum(["absolute", "per_100_reach", "per_100_views"]).optional(),
  analysisCoverage: z.object({
    examined: z.number(),
    observed: z.number(),
    missingEligible: z.number(),
    excludedByReason: z.record(z.string(), z.number()),
    open: z.number(),
    closed: z.number(),
  }),
  collectionObligations: z.object({
    expected: z.number(),
    captured: z.number(),
    missed: z.number(),
    open: z.number(),
    policyHistoryUnknown: z.number(),
    excludedByReason: z.record(z.string(), z.number()).optional(),
    minimumOpportunityMs: z.number(),
    note: z.string(),
  }),
});
export const maturitySchema = z.object({
  version: z.string(),
  sourceDelayMs: z.number(),
  periodEnded: z.boolean(),
  sourceDelayElapsed: z.boolean(),
  observedAfterDelay: z.boolean(),
  recheckDue: z.boolean(),
  matureByPolicy: z.boolean(),
  sourceFinal: z.literal(false),
});
