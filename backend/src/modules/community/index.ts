import type { RuntimeBindings } from "../../platform/config/runtime-config";
import type { InstagramReader } from "../instagram/public-contracts";
import { Comments } from "./application/comments";
import { D1Comments } from "./infrastructure/d1-comments";
import { createCommentsHttp } from "./presentation/http";
export type CommentOptions = {
  reader: (env: RuntimeBindings) => InstagramReader;
  media: (
    env: RuntimeBindings,
    id: string,
  ) => Promise<{ accountId: string; externalId: string; permalink: string }>;
  clock?: () => number;
};
export function createCommentOperations(env: RuntimeBindings, options: CommentOptions) {
  return new Comments(
    new D1Comments(env.DB),
    {
      media: (id) => options.media(env, id),
      read: (accountId, objectId, replies, cursor, limit) =>
        options.reader(env).comments(accountId, objectId, replies, cursor, limit),
    },
    options.clock ?? Date.now,
  );
}
export type { CommentCollection } from "./domain/model";
export function createCommentModule(options: CommentOptions) {
  return { router: createCommentsHttp((env) => createCommentOperations(env, options)) };
}
