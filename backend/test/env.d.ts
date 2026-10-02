import type { RuntimeBindings } from "../src/platform/config/runtime-config";

declare global {
  namespace Cloudflare {
    interface Env extends RuntimeBindings {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
