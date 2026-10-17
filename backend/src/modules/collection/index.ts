import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { Collect } from "./application/collect";
import type { CollectionAnalytics, CollectionComments } from "./application/ports";
import { D1Collection } from "./infrastructure/d1-collection";

export { collectionExecution } from "./application/execution-policy";
export type CollectionCommands = Pick<Collect, "start" | "advance" | "control" | "configure">;
export type CollectionReads = Pick<Collect, "job" | "status">;

export type CollectionOptions = {
  analytics: (env: RuntimeBindings) => CollectionAnalytics;
  comments: (env: RuntimeBindings) => CollectionComments;
  clock?: () => number;
};
async function operationId(key: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  digest[6] = ((digest[6] ?? 0) & 15) | 80;
  digest[8] = ((digest[8] ?? 0) & 63) | 128;
  const hex = [...digest.slice(0, 16)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function createCollectionOperations(env: RuntimeBindings, options: CollectionOptions) {
  return new Collect(
    new D1Collection(env.DB),
    options.analytics(env),
    options.comments(env),
    options.clock ?? Date.now,
    operationId,
    () => crypto.randomUUID(),
  );
}
