import { type CollectionOptions, createCollectionOperations } from "./index";
import { createCollectionHttp } from "./presentation/http";

export function createCollectionModule(options: CollectionOptions) {
  return { router: createCollectionHttp((env) => createCollectionOperations(env, options)) };
}
