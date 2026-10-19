import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionRunner } from "../src/app/collection-runner";
import { createApp } from "../src/app/create-app";
import { createCollectionExecutor } from "../src/app/create-features";
import { ApplicationError } from "../src/shared/application/application-error";
import { accountId, connect, fixture, sampleMedia, testKey } from "./helpers";

type Executor = ReturnType<typeof createCollectionExecutor>;
type RunnerInternals = { executor(): Executor };

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
  await env.DB.prepare("DELETE FROM oauth_attempts").run();
});
afterEach(() => vi.restoreAllMocks());

async function controlledRunner(name: string = crypto.randomUUID()) {
  const f = fixture();
  await connect(f);
  const stub = env.COLLECTION_RUNNER.getByName(name);
  await runInDurableObject(stub, async (instance, state) => {
    await state.storage.deleteAll();
    await state.storage.deleteAlarm();
    vi.spyOn(instance as unknown as RunnerInternals, "executor").mockImplementation(() =>
      createCollectionExecutor(env, { transport: () => f.transport }, f.now),
    );
  });
  return { ...f, stub };
}

async function alarmTime(stub: DurableObjectStub<CollectionRunner>) {
  return runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
}

function futureNoon() {
  // The alarm service uses its own wall clock and clamps past alarm times.
  // Keep mocked dates ahead of real time, including after UTC midnight.
  return Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000 + 12 * 3_600_000;
}

describe("Durable Object collection execution", () => {
  it("runs a daily pass in separate minute-spaced portions, persists it across eviction and keeps collecting between portions", async () => {
    let time = futureNoon();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const tick = vi.fn();
    const pruneReceipts = vi
      .fn()
      .mockResolvedValueOnce({ more: true })
      .mockResolvedValue({ more: false });
    const install = () =>
      runInDurableObject(stub, (instance) => {
        vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
          tick,
          nextWakeAt: async () => time + 1000,
        } as unknown as Executor);
        vi.spyOn(
          instance as unknown as { maintenance(): { pruneReceipts: typeof pruneReceipts } },
          "maintenance",
        ).mockReturnValue({ pruneReceipts });
      });
    await install();
    await stub.ensureAwake();
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).not.toHaveBeenCalled();
    const due = time + 86_400_000;
    time = due;
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenCalledExactlyOnceWith(due);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(await alarmTime(stub)).toBe(time + 1000);
    await runDurableObjectAlarm(stub);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(pruneReceipts).toHaveBeenCalledTimes(1);
    await evictDurableObject(stub);
    await install();
    time += 60_000;
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenLastCalledWith(due);
    expect(pruneReceipts).toHaveBeenCalledTimes(2);
    const wake = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get("receiptMaintenance"),
    );
    expect(wake).toEqual({ nextAt: due + 86_400_000, cutoffAt: null, batches: 0 });
    time += 60_000;
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenCalledTimes(2);
  });

  it("caps maintenance at 20 portions per day even with a large backlog and leaves an idle wake for tomorrow", async () => {
    let time = futureNoon();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const pruneReceipts = vi.fn().mockResolvedValue({ more: true });
    const tick = vi.fn();
    await runInDurableObject(stub, (instance) => {
      vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
        tick,
        nextWakeAt: async () => null,
      } as unknown as Executor);
      vi.spyOn(
        instance as unknown as { maintenance(): { pruneReceipts: typeof pruneReceipts } },
        "maintenance",
      ).mockReturnValue({ pruneReceipts });
    });
    await stub.ensureAwake();
    await runDurableObjectAlarm(stub);
    const due = time + 86_400_000;
    expect(await alarmTime(stub)).toBe(due);
    time = due;
    for (let i = 0; i < 20; i++) {
      await runDurableObjectAlarm(stub);
      time += 60_000;
    }
    expect(pruneReceipts).toHaveBeenCalledTimes(20);
    expect(await alarmTime(stub)).toBe(due + 86_400_000);
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenCalledTimes(20);
    time = due + 86_400_000;
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenLastCalledWith(time);
  });

  it("defers a maintenance failure without blocking collection and pauses all D1 work on daily quota", async () => {
    let time = futureNoon();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const tick = vi.fn();
    const pruneReceipts = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary maintenance failure"))
      .mockRejectedValueOnce(
        new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."),
      );
    await runInDurableObject(stub, (instance) => {
      vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
        tick,
        nextWakeAt: async () => time + 1000,
      } as unknown as Executor);
      vi.spyOn(
        instance as unknown as { maintenance(): { pruneReceipts: typeof pruneReceipts } },
        "maintenance",
      ).mockReturnValue({ pruneReceipts });
    });
    await stub.ensureAwake();
    await runDurableObjectAlarm(stub);
    time += 86_400_000;
    await runDurableObjectAlarm(stub);
    expect(await alarmTime(stub)).toBe(time + 1000);
    time += 60_000;
    await runDurableObjectAlarm(stub);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(pruneReceipts).toHaveBeenCalledTimes(1);
    time += 4 * 60_000;
    await runDurableObjectAlarm(stub);
    expect(pruneReceipts).toHaveBeenCalledTimes(2);
    expect(await alarmTime(stub)).toBe(
      Math.floor(time / 86_400_000) * 86_400_000 + 86_400_000 + 5000,
    );
    await runDurableObjectAlarm(stub);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(pruneReceipts).toHaveBeenCalledTimes(2);
  });

  it("persists daily D1 exhaustion across eviction, avoids more database work, and resumes after UTC reset", async () => {
    let time = futureNoon() + (11 * 60 + 58) * 60_000;
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const tick = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("query wrapper", {
          cause: new Error(
            "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
          ),
        }),
      )
      .mockResolvedValue(undefined);
    const advance = vi.fn();
    const install = () =>
      runInDurableObject(stub, (instance) => {
        vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
          tick,
          advance,
          nextWakeAt: async () => null,
        } as unknown as Executor);
      });
    await install();
    await stub.ensureAwake();
    await runDurableObjectAlarm(stub);
    const reset = Math.floor(time / 86_400_000) * 86_400_000 + 86_400_000 + 5000;
    expect(await alarmTime(stub)).toBe(reset);
    await stub.ensureAwake();
    expect(await alarmTime(stub)).toBe(reset);
    expect(await stub.advance(crypto.randomUUID())).toMatchObject({
      ok: false,
      code: "DATABASE_DAILY_LIMIT_REACHED",
      retryAfterMs: 125_000,
    });
    expect(advance).not.toHaveBeenCalled();
    await evictDurableObject(stub);
    await stub.ensureAwake();
    expect(await alarmTime(stub)).toBe(reset);
    expect(tick).toHaveBeenCalledTimes(1);
    time = reset + 1000;
    await install();
    await runDurableObjectAlarm(stub);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(await alarmTime(stub)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(
      await runInDurableObject(stub, (_instance, state) =>
        state.storage.get("databaseBlockedUntil"),
      ),
    ).toBeUndefined();
  });

  it("continues saved pages through alarms without waiting for another Cron or duplicating a committed page", async () => {
    const f = await controlledRunner();
    vi.mocked(f.transport.mediaPage)
      .mockResolvedValueOnce({ media: [sampleMedia], nextCursor: "second-page" })
      .mockResolvedValueOnce({ media: [], nextCursor: null });
    const id = crypto.randomUUID();
    expect(await f.stub.start(accountId, id, "catalogue", false)).toMatchObject({
      ok: true,
      value: { status: "running", pages: 0 },
    });
    expect(await alarmTime(f.stub)).not.toBeNull();
    expect(f.transport.mediaPage).not.toHaveBeenCalled();

    expect(await runDurableObjectAlarm(f.stub)).toBe(true);
    const first = await env.DB.prepare("SELECT pages,cursor FROM collection_jobs WHERE id=?")
      .bind(id)
      .first();
    expect(first).toMatchObject({ pages: 1, cursor: "second-page" });
    expect(await alarmTime(f.stub)).toBeLessThan(Date.now() + 5000);
    expect(vi.mocked(f.transport.mediaPage).mock.calls[0]?.[3]).toBe(1);

    const scheduled = await alarmTime(f.stub);
    await evictDurableObject(f.stub);
    expect(await alarmTime(f.stub)).toBe(scheduled);
    await runInDurableObject(f.stub, (instance) => {
      vi.spyOn(instance as unknown as RunnerInternals, "executor").mockImplementation(() =>
        createCollectionExecutor(env, { transport: () => f.transport }, f.now),
      );
    });

    // Model a legacy size-one page committed before the job checkpoint.
    await env.DB.prepare("UPDATE sync_runs SET page_size=1").run();
    await env.DB.prepare("UPDATE collection_jobs SET pages=0,cursor=NULL WHERE id=?")
      .bind(id)
      .run();
    expect(await f.stub.advance(id)).toMatchObject({ ok: true, value: { pages: 1 } });
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(1);
    expect(await runDurableObjectAlarm(f.stub)).toBe(true);
    expect(await f.stub.advance(id)).toMatchObject({
      ok: true,
      value: { status: "completed", pages: 2 },
    });
    expect(f.transport.mediaPage).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM media_snapshots").first()).toEqual({
      n: 1,
    });
    expect(await alarmTime(f.stub)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(
      await runInDurableObject(f.stub, (_instance, state) => state.storage.get("sequence")),
    ).toBe(2);
  });

  it("keeps HTTP command results and error codes and never starts collection from a GET", async () => {
    const f = await controlledRunner("owner");
    const app = createApp();
    const request = (path: string, method = "GET", body?: unknown) =>
      app.request(
        path,
        {
          method,
          headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const id = crypto.randomUUID();
    const created = await request(`/api/accounts/${accountId}/collection`, "POST", {
      operationId: id,
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ id, pages: 0, status: "running" });
    const before = await alarmTime(f.stub);
    expect((await request(`/api/collection-jobs/${id}`)).status).toBe(200);
    expect(await alarmTime(f.stub)).toBe(before);
    expect(f.transport.mediaPage).not.toHaveBeenCalled();
    const advanced = await request(`/api/collection-jobs/${id}/advance`, "POST", {});
    expect(advanced.status).toBe(200);
    expect(await advanced.json()).toMatchObject({ id, pages: 1, status: "completed" });
    const missing = await request(
      `/api/collection-jobs/${crypto.randomUUID()}/advance`,
      "POST",
      {},
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });
    await runInDurableObject(f.stub, async (_instance, state) => state.storage.deleteAlarm());
  });

  it("recovers a missing wake without postponing an existing alarm", async () => {
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    await stub.ensureAwake();
    const first = await alarmTime(stub);
    await stub.ensureAwake();
    expect(await alarmTime(stub)).toBe(first);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await stub.ensureAwake();
    expect(await alarmTime(stub)).not.toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await alarmTime(stub)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it("disables automatic alarms for rollback without deleting D1 jobs or cursors", async () => {
    const f = await controlledRunner();
    const id = crypto.randomUUID();
    await f.stub.start(accountId, id, "catalogue", false);
    await runInDurableObject(f.stub, async (_instance, state) => {
      const paused = new CollectionRunner(state, { ...env, COLLECTION_RUNNER_ENABLED: "false" });
      await paused.ensureAwake();
      expect(await state.storage.getAlarm()).toBeNull();
      await paused.alarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(f.transport.mediaPage).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare("SELECT status,pages,cursor FROM collection_jobs WHERE id=?")
        .bind(id)
        .first(),
    ).toEqual({ status: "running", pages: 0, cursor: null });
  });

  it("re-arms after more than six infrastructure failures and persists the recovery wake before work", async () => {
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    const attempts = vi.fn(async () => {
      expect(await alarmTime(stub)).not.toBeNull();
      throw new Error("synthetic infrastructure failure");
    });
    await runInDurableObject(stub, (instance) => {
      vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
        tick: attempts,
      } as unknown as Executor);
    });
    await stub.ensureAwake();
    for (let i = 0; i < 8; i++) {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(await alarmTime(stub)).toBeGreaterThan(Date.now());
    }
    expect(attempts).toHaveBeenCalledTimes(8);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get("sequence")).toBe(2);
      expect(await state.storage.get("failures")).toBe(7);
      await state.storage.deleteAlarm();
    });
  });

  it("serializes concurrent manual continuation with an in-flight alarm and hides unexpected RPC errors", async () => {
    const stub = env.COLLECTION_RUNNER.getByName(crypto.randomUUID());
    await runInDurableObject(stub, async (instance, state) => {
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const advance = vi.fn(async () => {
        throw new ApplicationError("INSTAGRAM_RATE_LIMITED", "Wait for the source quota.", 60_000);
      });
      vi.spyOn(instance as unknown as RunnerInternals, "executor").mockReturnValue({
        tick: async () => {
          entered();
          await gate;
        },
        nextWakeAt: async () => null,
        advance,
      } as unknown as Executor);
      const runner = instance as CollectionRunner;
      const alarm = runner.alarm();
      await started;
      const command = runner.advance(crypto.randomUUID());
      await Promise.resolve();
      expect(advance).not.toHaveBeenCalled();
      release();
      await alarm;
      expect(await command).toEqual({
        ok: false,
        code: "INSTAGRAM_RATE_LIMITED",
        message: "Wait for the source quota.",
        retryAfterMs: 60_000,
      });
      advance.mockRejectedValueOnce(new Error("synthetic-secret-provider-payload"));
      expect(await runner.advance(crypto.randomUUID())).toEqual({
        ok: false,
        code: "INTERNAL_ERROR",
        message: "The collection command failed.",
      });
      await state.storage.deleteAlarm();
    });
  });
});
