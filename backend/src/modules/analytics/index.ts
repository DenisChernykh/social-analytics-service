import type { RuntimeBindings } from "../../platform/config/runtime-config";
import { ApplicationError } from "../../shared/application/application-error";
import type { InstagramReader } from "../instagram/public-contracts";
import { AnalyticsQueries } from "./application/queries";
import { SyncAccount } from "./application/sync-account";
import { D1Analytics } from "./infrastructure/d1-analytics";
import { InstagramSource, instagramReportDefinition } from "./infrastructure/instagram-source";

export { metricKeys } from "./domain/model";

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
