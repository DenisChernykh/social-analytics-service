import { type CommentOptions, createCommentOperations } from "./index";
import { createCommentsHttp } from "./presentation/http";

export function createCommentModule(options: CommentOptions) {
  return { router: createCommentsHttp((env) => createCommentOperations(env, options)) };
}
