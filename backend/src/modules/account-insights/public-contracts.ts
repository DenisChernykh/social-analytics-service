import { createInsightOperations, type InsightOptions } from "./index";
import { createInsightsHttp } from "./presentation/http";

export function createInsightModule(options: InsightOptions) {
  return { router: createInsightsHttp((env) => createInsightOperations(env, options)) };
}
export { activityReportSchema } from "./presentation/http";
