import { type ContentOptions, createContentOperations } from "./index";
import { createContentHttp } from "./presentation/http";

export function createContentModule(options: ContentOptions) {
  return { router: createContentHttp((env) => createContentOperations(env, options)) };
}
