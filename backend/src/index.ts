import type { createApp } from "./app/create-app";
import { collectionRunner } from "./app/durable-collection";

export { CollectionRunner } from "./app/collection-runner";

import type { RuntimeBindings } from "./platform/config/runtime-config";

// HTTP schema construction is deferred until an HTTP request reaches this isolate.
// Cron imports only the operation factories, so a background cold start avoids it.
let appPromise: Promise<ReturnType<typeof createApp>> | undefined;
export default {
  async fetch(request: Request, env: RuntimeBindings, ctx: ExecutionContext) {
    appPromise ??= import("./app/create-app").then(({ createApp }) => createApp());
    const app = await appPromise;
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: RuntimeBindings, ctx: ExecutionContext) {
    ctx.waitUntil(collectionRunner(env).ensureAwake());
  },
};
