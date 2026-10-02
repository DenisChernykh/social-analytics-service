import type { RuntimeBindings } from "../config/runtime-config";

export type HttpEnv = { Bindings: RuntimeBindings; Variables: { requestId: string } };
