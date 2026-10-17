import type { RuntimeBindings } from "../../platform/config/runtime-config";
import {
  type CollectionCommands,
  type CollectionOptions,
  createCollectionOperations,
} from "./index";
import { createCollectionHttp } from "./presentation/http";

export function createCollectionModule(
  options: CollectionOptions,
  commands: (env: RuntimeBindings) => CollectionCommands,
) {
  return {
    router: createCollectionHttp((env) => createCollectionOperations(env, options), commands),
  };
}
