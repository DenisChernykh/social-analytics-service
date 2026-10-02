import type { RuntimeBindings } from "../../platform/config/runtime-config";
import type { InstagramReader } from "../instagram/public-contracts";
import { AnalyticsQueries } from "./application/queries";
import { SyncAccount } from "./application/sync-account";
import { D1Analytics } from "./infrastructure/d1-analytics";
import { InstagramSource, metricDefinitions } from "./infrastructure/instagram-source";
import { createAnalyticsHttp } from "./presentation/http";

export type AnalyticsModuleOptions = {
  reader: (env: RuntimeBindings) => InstagramReader;
  clock?: () => number;
};
export function createAnalyticsOperations(env: RuntimeBindings, options: AnalyticsModuleOptions) {
  const repository = new D1Analytics(env.DB);
  const clock = options.clock ?? Date.now;
  return {
    queries: new AnalyticsQueries(repository, clock),
    sync: new SyncAccount(
      repository,
      new InstagramSource(() => options.reader(env), env.INSTAGRAM_API_VERSION, clock),
      clock,
    ),
  };
}
export function createAnalyticsModule(options: AnalyticsModuleOptions) {
  return {
    router: createAnalyticsHttp(
      (env) => createAnalyticsOperations(env, options),
      metricDefinitions,
    ),
  };
}
