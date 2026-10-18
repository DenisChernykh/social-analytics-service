import { DurableObject } from "cloudflare:workers";
import type { CollectionCommands } from "../modules/collection";
import { createInstagramMaintenance } from "../modules/instagram";
import type { RuntimeBindings } from "../platform/config/runtime-config";
import { databaseDailyLimitError } from "../platform/database/d1-errors";
import { ApplicationError, type ErrorCode } from "../shared/application/application-error";
import { createCollectionExecutor } from "./create-features";

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; retryAfterMs?: number };

const recoveryIntervalMs = 5 * 60_000;
const maintenanceDayMs = 86_400_000;
const maintenanceIntervalMs = 60_000;
const maintenanceDailyBatches = 20;
type MaintenanceWake = { nextAt: number; cutoffAt: number | null; batches: number };

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
      const blocked = await this.blockedError();
      if (blocked) await this.ctx.storage.setAlarm(Date.now() + (blocked.retryAfterMs ?? 0));
      else if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 1000);
    });
  }

  private executor() {
    // A fresh scope for every portion: budgets and decrypted credentials are
    // never reused across commands or alarm invocations.
    return createCollectionExecutor(this.env);
  }

  private maintenance() {
    return createInstagramMaintenance(this.env);
  }

  private async maintenanceWake(): Promise<MaintenanceWake> {
    const saved = await this.ctx.storage.get<MaintenanceWake>("receiptMaintenance");
    if (saved) return saved;
    // Start tomorrow rather than adding maintenance to deployment/recovery.
    const initial = { nextAt: Date.now() + maintenanceDayMs, cutoffAt: null, batches: 0 };
    await this.ctx.storage.put("receiptMaintenance", initial);
    return initial;
  }

  private async maintain(wake: MaintenanceWake) {
    const now = Date.now();
    const cutoffAt = wake.cutoffAt ?? now;
    const batches = wake.batches + 1;
    // Reserve the delay and daily budget before D1 work. A hard termination
    // must not turn retries into a tight cleanup loop.
    const next: MaintenanceWake =
      batches >= maintenanceDailyBatches
        ? {
            nextAt: Math.max(now + maintenanceIntervalMs, cutoffAt + maintenanceDayMs),
            cutoffAt: null,
            batches: 0,
          }
        : { nextAt: now + maintenanceIntervalMs, cutoffAt, batches };
    await this.ctx.storage.put("receiptMaintenance", next);
    try {
      const result = await this.maintenance().pruneReceipts(cutoffAt);
      if (!result.more)
        await this.ctx.storage.put("receiptMaintenance", {
          nextAt: Math.max(Date.now() + maintenanceIntervalMs, cutoffAt + maintenanceDayMs),
          cutoffAt: null,
          batches: 0,
        } satisfies MaintenanceWake);
    } catch (error) {
      // Daily exhaustion pauses all D1 work. Other cleanup failures defer only
      // maintenance, leaving collection commands/alarms available.
      if (databaseDailyLimitError(error, Date.now())) throw error;
      await this.ctx.storage.put("receiptMaintenance", {
        ...next,
        nextAt: Math.max(next.nextAt, Date.now() + recoveryIntervalMs),
      });
    }
  }

  private async blockedError() {
    const until = (await this.ctx.storage.get<number>("databaseBlockedUntil")) ?? 0;
    if (until > Date.now())
      return new ApplicationError(
        "DATABASE_DAILY_LIMIT_REACHED",
        "The daily database limit is exhausted. Collection can resume after 00:00 UTC.",
        until - Date.now(),
      );
    if (until) await this.ctx.storage.delete("databaseBlockedUntil");
    return null;
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
    const collectionAt = await executor.nextWakeAt();
    const maintenance = await this.maintenanceWake();
    const next = Math.min(collectionAt ?? Infinity, maintenance.nextAt);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  private async retry(error?: unknown) {
    const dailyLimit = databaseDailyLimitError(error, Date.now());
    if (dailyLimit) {
      const until = Date.now() + (dailyLimit.retryAfterMs ?? recoveryIntervalMs);
      await this.ctx.storage.put("databaseBlockedUntil", until);
      if (this.env.COLLECTION_RUNNER_ENABLED === "true") await this.ctx.storage.setAlarm(until);
      return;
    }
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
      const blocked = await this.blockedError();
      if (blocked) {
        await this.ctx.storage.setAlarm(Date.now() + (blocked.retryAfterMs ?? 0));
        return;
      }
      // Persist a future wake before any D1/source work. A hard termination
      // cannot leave a successful claim without another recovery opportunity.
      await this.armRecovery();
      try {
        const executor = this.executor();
        const maintenance = await this.maintenanceWake();
        if (maintenance.nextAt <= Date.now()) await this.maintain(maintenance);
        else {
          const sequence = (await this.ctx.storage.get<number>("sequence")) ?? 0;
          await this.ctx.storage.put("sequence", (sequence + 1) % 6);
          await executor.tick(sequence);
        }
        await this.reschedule(executor);
        await this.ctx.storage.delete("failures");
      } catch (error) {
        // Automatic alarm retries are finite; re-arm explicitly for outages.
        // Neither raw provider errors nor credentials are logged or persisted.
        await this.retry(error);
      }
    });
  }

  private command<T>(
    action: (executor: ReturnType<typeof createCollectionExecutor>) => Promise<T>,
  ) {
    return this.serial(async (): Promise<CommandResult<T>> => {
      const blocked = await this.blockedError();
      if (blocked)
        return {
          ok: false,
          code: blocked.code,
          message: blocked.message,
          retryAfterMs: blocked.retryAfterMs,
        };
      await this.armRecovery();
      const executor = this.executor();
      try {
        const value = await action(executor);
        await this.reschedule(executor);
        return { ok: true, value };
      } catch (error) {
        const known =
          databaseDailyLimitError(error, Date.now()) ??
          (error instanceof ApplicationError ? error : null);
        if (known?.code === "DATABASE_DAILY_LIMIT_REACHED") await this.retry(known);
        else if (known) {
          try {
            await this.reschedule(executor);
          } catch (rescheduleError) {
            await this.retry(rescheduleError);
          }
        } else await this.retry(error);
        return known
          ? {
              ok: false,
              code: known.code,
              message: known.message,
              ...(known.retryAfterMs === undefined ? {} : { retryAfterMs: known.retryAfterMs }),
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
