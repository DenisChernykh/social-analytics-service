import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { Content } from "./application/content";
import type { ContentAnalytics } from "./application/ports";
import { D1Content } from "./infrastructure/d1-content";

export type ContentOptions = {
  analytics: (env: RuntimeBindings) => ContentAnalytics;
  clock?: () => number;
};
export function createContentOperations(env: RuntimeBindings, options: ContentOptions) {
  return new Content(new D1Content(env.DB), options.analytics(env), options.clock ?? Date.now);
}
export type { RankInput } from "./application/content";
