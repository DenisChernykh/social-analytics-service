import { instagramConfig, type RuntimeBindings } from "../../platform/config/runtime-config";
import { TokenCipher } from "../../platform/crypto/secrets";
import { InstagramConnections } from "./application/connections";
import type { InstagramTransport } from "./application/ports";
import { D1Connections } from "./infrastructure/d1-connections";
import { MetaClient, type MetaClientConfig } from "./infrastructure/meta-client";
import { createInstagramHttp } from "./presentation/http";

export type InstagramModuleOptions = {
  transport?: (config: MetaClientConfig) => InstagramTransport;
  clock?: () => number;
};
export function createInstagramOperations(
  env: RuntimeBindings,
  options: InstagramModuleOptions = {},
) {
  const config = instagramConfig(env);
  return new InstagramConnections(
    new D1Connections(env.DB),
    options.transport?.(config) ?? new MetaClient(config),
    new TokenCipher(config.encryptionKey),
    options.clock ?? Date.now,
  );
}
export function createInstagramModule(options: InstagramModuleOptions = {}) {
  return { router: createInstagramHttp((env) => createInstagramOperations(env, options)) };
}
