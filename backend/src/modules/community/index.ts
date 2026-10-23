import type { RuntimeBindings } from "../../platform/config/runtime-config";
import type { InstagramReader } from "../instagram/public-contracts";
import { Comments } from "./application/comments";
import { D1Comments } from "./infrastructure/d1-comments";
export type CommentOptions = {
  reader: (env: RuntimeBindings) => InstagramReader;
  media: (
    env: RuntimeBindings,
    id: string,
  ) => Promise<{ accountId: string; externalId: string; permalink: string }>;
  clock?: () => number;
};
export function createCommentOperations(env: RuntimeBindings, options: CommentOptions) {
  let reader: InstagramReader | undefined;
  return new Comments(
    new D1Comments(env.DB),
    {
      media: (id) => options.media(env, id),
      requestStats: () => reader?.requestStats?.() ?? { attempts: 0 },
      read: (accountId, objectId, replies, cursor, limit, expandReplies, operationId) => {
        reader ??= options.reader(env);
        return (operationId ? (reader.forOperation?.(operationId) ?? reader) : reader).comments(
          accountId,
          objectId,
          replies,
          cursor,
          limit,
          expandReplies,
        );
      },
    },
    options.clock ?? Date.now,
  );
}
export type { CommentCollection } from "./domain/model";

export function createCommentMaintenance(env: RuntimeBindings) {
  return new D1Comments(env.DB);
}
