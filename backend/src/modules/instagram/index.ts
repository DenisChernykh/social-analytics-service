import { instagramConfig, type RuntimeBindings } from "../../platform/config/runtime-config";
import { sha256, TokenCipher } from "../../platform/crypto/secrets";
import { type CommentWebhookPort, InstagramCommentWebhooks } from "./application/comment-webhooks";
import { InstagramConnections } from "./application/connections";
import type { InstagramTransport } from "./application/ports";
import { D1Connections } from "./infrastructure/d1-connections";
import { MetaClient, type MetaClientConfig } from "./infrastructure/meta-client";
import { verifyWebhookSignature } from "./infrastructure/webhook-signature";
import { createCommentWebhooksHttp } from "./presentation/comment-webhooks";
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
export function createCommentWebhookModule(options: {
  port: (env: RuntimeBindings) => Omit<CommentWebhookPort, "digest" | "verify">;
}) {
  return {
    router: createCommentWebhooksHttp(
      (env) =>
        new InstagramCommentWebhooks({
          ...options.port(env),
          digest: sha256,
          verify: (body, signature) =>
            verifyWebhookSignature(body, signature, env.INSTAGRAM_CLIENT_SECRET ?? ""),
        }),
    ),
  };
}
export type { CommentWebhookPort } from "./application/comment-webhooks";
