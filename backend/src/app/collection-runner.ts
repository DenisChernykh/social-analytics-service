import { DurableObject } from "cloudflare:workers";
import type { CollectionCommands } from "../modules/collection";
import type { RuntimeBindings } from "../platform/config/runtime-config";
import { ApplicationError, type ErrorCode } from "../shared/application/application-error";
import { createCollectionExecutor } from "./create-features";

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; retryAfterMs?: number };

const recoveryIntervalMs = 5 * 60_000;

export class CollectionRunner extends DurableObject<RuntimeBindings> {
  // RPC calls may interleave at awaits. Serialize commands with alarms as well
  // as retaining D1 leases, which also fence older deployments and direct sync.
  private pending: Promise<unknown> = Promise.resolve();

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  async ensureAwake() {
    return this.serial(async () => {
      if (this.env.COLLECTION_RUNNER_ENABLED !== "true") {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 1000);
    });
  }

  private executor() {
    // A fresh scope for every portion: budgets and decrypted credentials are
    // never reused across commands or alarm invocations.
    return createCollectionExecutor(this.env);
  }

  private async armRecovery() {
    if (this.env.COLLECTION_RUNNER_ENABLED === "true")
      await this.ctx.storage.setAlarm(Date.now() + recoveryIntervalMs);
  }

  private async reschedule(executor: ReturnType<typeof createCollectionExecutor>) {
    if (this.env.COLLECTION_RUNNER_ENABLED !== "true") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = await executor.nextWakeAt();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  private async retry() {
    const failures = Math.min((await this.ctx.storage.get<number>("failures")) ?? 0, 6) + 1;
    await this.ctx.storage.put("failures", failures);
    if (this.env.COLLECTION_RUNNER_ENABLED === "true")
      await this.ctx.storage.setAlarm(
        Date.now() + Math.min(recoveryIntervalMs, 5000 * 2 ** (failures - 1)),
      );
  }

  async alarm() {
    return this.serial(async () => {
      if (this.env.COLLECTION_RUNNER_ENABLED !== "true") {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      // Persist a future wake before any D1/source work. A hard termination
      // cannot leave a successful claim without another recovery opportunity.
      await this.armRecovery();
      try {
        const sequence = (await this.ctx.storage.get<number>("sequence")) ?? 0;
        await this.ctx.storage.put("sequence", (sequence + 1) % 6);
        const executor = this.executor();
        await executor.tick(sequence);
        await this.reschedule(executor);
        await this.ctx.storage.delete("failures");
      } catch {
        // Automatic alarm retries are finite; re-arm explicitly for outages.
        // Neither raw provider errors nor credentials are logged or persisted.
        await this.retry();
      }
    });
  }

  private command<T>(
    action: (executor: ReturnType<typeof createCollectionExecutor>) => Promise<T>,
  ) {
    return this.serial(async (): Promise<CommandResult<T>> => {
      await this.armRecovery();
      const executor = this.executor();
      try {
        const value = await action(executor);
        await this.reschedule(executor);
        return { ok: true, value };
      } catch (error) {
        if (error instanceof ApplicationError) {
          try {
            await this.reschedule(executor);
          } catch {
            await this.retry();
          }
        } else await this.retry();
        return error instanceof ApplicationError
          ? {
              ok: false,
              code: error.code,
              message: error.message,
              ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
            }
          : { ok: false, code: "INTERNAL_ERROR", message: "The collection command failed." };
      }
    });
  }

  start(...args: Parameters<CollectionCommands["start"]>) {
    return this.command((executor) => executor.start(...args));
  }
  advance(...args: Parameters<CollectionCommands["advance"]>) {
    return this.command((executor) => executor.advance(...args));
  }
  control(...args: Parameters<CollectionCommands["control"]>) {
    return this.command((executor) => executor.control(...args));
  }
  configure(...args: Parameters<CollectionCommands["configure"]>) {
    return this.command((executor) => executor.configure(...args));
  }
}
