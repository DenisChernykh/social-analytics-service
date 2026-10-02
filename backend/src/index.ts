import { createApp } from "./app/create-app";
import { createScheduledOperations } from "./app/create-features";
import type { RuntimeBindings } from "./platform/config/runtime-config";

const app = createApp();
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: RuntimeBindings, ctx: ExecutionContext) {
    ctx.waitUntil(createScheduledOperations(env).tick());
  },
};
