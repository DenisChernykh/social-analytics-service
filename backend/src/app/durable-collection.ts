import type { CollectionCommands } from "../modules/collection";
import type { RuntimeBindings } from "../platform/config/runtime-config";
import { ApplicationError } from "../shared/application/application-error";
import type { CommandResult } from "./collection-runner";

export function collectionRunner(env: RuntimeBindings) {
  return env.COLLECTION_RUNNER.getByName("owner");
}

async function result<T>(response: Promise<CommandResult<T>>): Promise<T> {
  const value = await response;
  if (!value.ok) throw new ApplicationError(value.code, value.message, value.retryAfterMs);
  return value.value;
}

export function durableCollectionCommands(env: RuntimeBindings): CollectionCommands {
  const runner = collectionRunner(env);
  return {
    start: (...args) => result(runner.start(...args)),
    advance: (...args) => result(runner.advance(...args)),
    control: (...args) => result(runner.control(...args)),
    configure: (...args) => result(runner.configure(...args)),
  };
}
