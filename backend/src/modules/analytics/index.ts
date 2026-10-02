import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { ApplicationError } from "../../shared/application/application-error";
import type { InstagramReader } from "../instagram/public-contracts";
import { AnalyticsQueries } from "./application/queries";
import { SyncAccount } from "./application/sync-account";
import { D1Analytics } from "./infrastructure/d1-analytics";
import {
  InstagramSource,
  instagramReportDefinition,
  metricDefinitions,
} from "./infrastructure/instagram-source";
import { createAnalyticsHttp } from "./presentation/http";

export type AnalyticsModuleOptions = {
  reader: (env: RuntimeBindings) => InstagramReader;
  clock?: () => number;
};
export function createAnalyticsOperations(env: RuntimeBindings, options: AnalyticsModuleOptions) {
  const repository = new D1Analytics(env.DB);
  const clock = options.clock ?? Date.now;
  return {
    queries: new AnalyticsQueries(repository, clock, (platform, productType) => {
      if (platform !== "instagram")
        throw new ApplicationError(
          "CONFIGURATION_REQUIRED",
          "No report adapter is connected for this platform.",
        );
      return instagramReportDefinition(productType);
    }),
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
      Object.fromEntries(
        Object.entries(metricDefinitions).map(([key, definition]) => [
          key,
          {
            ...definition,
            appliesTo:
              definition.appliesTo === "all"
                ? ["views", "reach"].includes(key)
                  ? "FEED,REELS,STORY"
                  : "FEED,REELS"
                : definition.appliesTo === "reels"
                  ? "REELS"
                  : "FEED",
            definition: `Instagram ${definition.field}; units=${definition.unit}; availability is specific to the publication, permissions and API version.`,
          },
        ]),
      ),
    ),
  };
}
export { accountSchema, mediaSchema, snapshotSchema, summarySchema } from "./presentation/schemas";
