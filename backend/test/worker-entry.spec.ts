import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { RuntimeBindings } from "../src/platform/config/runtime-config";

const calls = vi.hoisted(() => ({
  httpImports: 0,
  createApp: vi.fn(),
  fetch: vi.fn<
    (request: Request, env: RuntimeBindings, ctx: ExecutionContext) => Promise<Response>
  >(async () => new Response("ok")),
  runner: vi.fn(),
  ensureAwake: vi.fn(async () => undefined),
}));
vi.mock("../src/app/create-app", () => {
  calls.httpImports++;
  calls.createApp.mockReturnValue({ fetch: calls.fetch });
  return { createApp: calls.createApp };
});
vi.mock("../src/app/durable-collection", () => {
  calls.runner.mockReturnValue({ ensureAwake: calls.ensureAwake });
  return { collectionRunner: calls.runner };
});

it("only wakes the Durable Object from Cron without initializing HTTP and shares only the router across concurrent HTTP requests", async () => {
  vi.resetModules();
  const { default: worker } = await import("../src/index");
  const ctx = createExecutionContext();
  const waitUntil = vi.spyOn(ctx, "waitUntil");
  const controller = createScheduledController({ cron: "*/5 * * * *", scheduledTime: 0 });
  worker.scheduled(controller, env, ctx);
  expect(calls.runner).toHaveBeenCalledOnce();
  expect(calls.runner.mock.calls[0]?.[0]).toBe(env);
  expect(calls.ensureAwake).toHaveBeenCalledOnce();
  expect(waitUntil).toHaveBeenCalledExactlyOnceWith(calls.ensureAwake.mock.results[0]?.value);
  expect(calls.httpImports).toBe(0);
  expect(calls.createApp).not.toHaveBeenCalled();

  const request = new Request("https://example.test/health");
  const secondRequest = new Request("https://example.test/openapi.json");
  const secondEnv = { ...env, BUILD_REVISION: "another-invocation" };
  const secondCtx = createExecutionContext();
  const responses = await Promise.all([
    worker.fetch(request, env, ctx),
    worker.fetch(secondRequest, secondEnv, secondCtx),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(calls.httpImports).toBe(1);
  expect(calls.createApp).toHaveBeenCalledOnce();
  expect(calls.fetch).toHaveBeenCalledTimes(2);
  expect(calls.fetch.mock.calls[0]?.[0]).toBe(request);
  expect(calls.fetch.mock.calls[0]?.[1]).toBe(env);
  expect(calls.fetch.mock.calls[0]?.[2]).toBe(ctx);
  expect(calls.fetch.mock.calls[1]?.[0]).toBe(secondRequest);
  expect(calls.fetch.mock.calls[1]?.[1]).toBe(secondEnv);
  expect(calls.fetch.mock.calls[1]?.[2]).toBe(secondCtx);

  worker.scheduled(controller, secondEnv, secondCtx);
  expect(calls.runner.mock.lastCall?.[0]).toBe(secondEnv);
  expect(calls.ensureAwake).toHaveBeenCalledTimes(2);
  expect(calls.createApp).toHaveBeenCalledOnce();
});
