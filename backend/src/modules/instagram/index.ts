import { instagramConfig, type RuntimeBindings } from "../../platform/config/runtime-config";
import { TokenCipher } from "../../platform/crypto/secrets";
import { InstagramConnections } from "./application/connections";
import type { InstagramTransport } from "./application/ports";
import { D1Connections } from "./infrastructure/d1-connections";
import { D1RequestPolicy } from "./infrastructure/d1-request-policy";
import { MetaClient, type MetaClientConfig } from "./infrastructure/meta-client";

export type InstagramModuleOptions = {
  requestBudget?: import("./public-contracts").RequestBudget;
  transport?: (config: MetaClientConfig) => InstagramTransport;
  clock?: () => number;
};
export function createInstagramOperations(
  env: RuntimeBindings,
  options: InstagramModuleOptions = {},
) {
  const config = instagramConfig(env);
  const policy = new D1RequestPolicy(env.DB);
  return new InstagramConnections(
    new D1Connections(env.DB),
    options.transport?.(config) ??
      new MetaClient(config, fetch, {
        policy,
        clock: options.clock,
        budget: options.requestBudget,
      }),
    new TokenCipher(config.encryptionKey),
    options.clock ?? Date.now,
    policy,
    config.apiVersion,
  );
}
export type { CommentWebhookPort } from "./application/comment-webhooks";
