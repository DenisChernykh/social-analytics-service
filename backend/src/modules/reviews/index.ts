import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { Review, type ReviewEvidence } from "./application/review";
import { createReviewHttp } from "./presentation/http";
export type ReviewOptions = {
  evidence: (env: RuntimeBindings) => ReviewEvidence;
  clock?: () => number;
};
export function createReviewOperations(env: RuntimeBindings, options: ReviewOptions) {
  return new Review(options.evidence(env), options.clock ?? Date.now);
}
export function createReviewModule(
  options: ReviewOptions,
  schemas: Parameters<typeof createReviewHttp> extends [unknown, ...infer Rest] ? Rest : never,
) {
  return { router: createReviewHttp((env) => createReviewOperations(env, options), ...schemas) };
}
