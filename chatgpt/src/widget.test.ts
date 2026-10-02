import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createContext, Script } from "node:vm";
import { WIDGET_HTML } from "./widget.ts";

class Element {
  textContent = "";
  value = "";
  checked = false;
  hidden = false;
  disabled = false;
  children: Element[] = [];
  dataset: Record<string, string> = {};
  style = { setProperty: (_key: string, _value: string) => {} };
  handlers = new Map<string, (event: unknown) => unknown>();
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  setAttribute(_key: string, _value: string) {}
  addEventListener(name: string, handler: (event: unknown) => unknown) {
    this.handlers.set(name, handler);
  }
  trigger(name: string) {
    this.handlers.get(name)?.({ preventDefault() {} });
  }
}
const account = { id: "ig_1", username: "Owner", platform: "instagram", lastSyncedAt: 1000 };
const schedule = { enabled: false, discoveryMinutes: 360, lastSuccessAt: null };
const panel = {
  mode: "status",
  accounts: [account],
  selectedAccountId: account.id,
  collection: { schedule, jobs: [] },
  history: { observedFrom: 1000, sampled: 2, beginningKnown: false },
};
const media = {
  id: "ig_media_2",
  accountId: "ig_1",
  title: null,
  caption: '<img src=x onerror="attack()">',
  publishedAt: 1000,
  productType: "REELS",
  permalink: "https://www.instagram.com/reel/test2/",
};
const report = {
  media,
  source: { provider: "instagram_api", observedAt: 1000 },
  metrics: {
    views: { value: 0, unit: "count" },
    reach: { value: null, reason: "not_returned", unit: "count" },
  },
};
type Invocation = { name: string; arguments: Record<string, unknown> };
async function widget(hostTool: (call: Invocation) => unknown) {
  const nodes = new Map<string, Element>(),
    all: Element[] = [];
  for (const match of WIDGET_HTML.matchAll(/id="([a-z-]+)"/g)) {
    const node = new Element();
    nodes.set(match[1], node);
    all.push(node);
  }
  const messages: Record<string, unknown>[] = [];
  let listener: (event: { source: unknown; data: unknown }) => void = () => {};
  const parent = {
    postMessage(message: Record<string, unknown>) {
      messages.push(message);
      if (typeof message.id === "number")
        queueMicrotask(async () => {
          let result: unknown = { hostContext: { theme: "dark" } };
          if (message.method === "tools/call")
            result = await hostTool(message.params as Invocation);
          listener({ source: parent, data: { jsonrpc: "2.0", id: message.id, result } });
        });
    },
  };
  const context = createContext({
    window: {
      parent,
      addEventListener(_name: string, handler: typeof listener) {
        listener = handler;
      },
    },
    document: {
      getElementById: (id: string) => nodes.get(id),
      createElement() {
        const node = new Element();
        all.push(node);
        return node;
      },
      querySelectorAll: () => all,
      body: { scrollHeight: 600 },
      documentElement: { ...new Element(), clientWidth: 400 },
    },
    crypto: { randomUUID },
    setTimeout: () => 1,
    clearTimeout: () => {},
    URL,
    Date,
    Map,
    Set,
    console,
  });
  new Script(
    WIDGET_HTML.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? "",
  ).runInContext(context);
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  await settle();
  return {
    nodes,
    messages,
    settle,
    receive(data: unknown, foreign = false) {
      listener({
        source: foreign ? {} : parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: { data } },
        },
      });
    },
  };
}
const result = (data: unknown) => ({ structuredContent: { data }, content: [] });
test("Card reads confirmed state without starting collection; full catalogue is distinct from latest page", async () => {
  const calls: Invocation[] = [];
  const w = await widget((call) => {
    calls.push(call);
    return result(panel);
  });
  w.receive(panel);
  await w.settle();
  assert.equal(calls.length, 0);
  assert.ok(
    w.nodes
      .get("facts")
      ?.children.some((node) => node.textContent.includes("Полнота пока не подтверждена")),
  );
  w.nodes.get("reload")?.trigger("click");
  await w.settle();
  assert.deepEqual(
    calls.map((c) => c.name),
    ["open_social_analytics"],
  );
  w.receive({
    ...panel,
    collection: {
      ...panel.collection,
      jobs: [{ origin: "manual", status: "completed", completedAt: 2000, collected: 12 }],
    },
  });
  assert.ok(
    w.nodes
      .get("facts")
      ?.children.some((node) => node.textContent.includes("Полный проход завершён")),
  );
});
test("Card displays the total saved history instead of a 100-observation sample", async () => {
  const w = await widget(() => result(panel));
  w.receive({ ...panel, history: { observedFrom: 1000, sampled: 325, beginningKnown: true } });
  assert.ok(
    w.nodes
      .get("facts")
      ?.children.some(
        (node) =>
          node.textContent.includes("325 наблюдений") &&
          node.textContent.includes("начало сохранённого сбора"),
      ),
  );
});
test("Collection and recurring schedule have separate explicit calls, and uncertain collection checks its UUID", async () => {
  const calls: Invocation[] = [];
  const w = await widget((call) => {
    calls.push(call);
    if (call.name === "collect_all")
      return { isError: true, structuredContent: { code: "RESPONSE_UNCERTAIN" } };
    return result(call.name === "get_collection_job" ? { status: "running" } : panel);
  });
  w.receive(panel);
  w.nodes.get("collect")?.trigger("click");
  await w.settle();
  assert.deepEqual(
    calls.map((c) => c.name),
    ["collect_all"],
  );
  const body = calls[0].arguments.body as { operationId: string; stories: boolean };
  assert.match(body.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(body.stories, false);
  w.nodes.get("collect")?.trigger("click");
  await w.settle();
  assert.deepEqual(
    calls.map((c) => c.name),
    ["collect_all", "get_collection_job", "open_social_analytics"],
  );
  assert.equal(calls[1].arguments.jobId, body.operationId);
  const automatic = w.nodes.get("automatic");
  assert.ok(automatic);
  automatic.checked = true;
  w.nodes.get("automatic")?.trigger("change");
  await w.settle();
  const configured = calls.find((c) => c.name === "set_collection_schedule");
  assert.ok(configured);
  assert.equal((configured.arguments.body as { enabled: boolean }).enabled, true);
});
test("Ambiguous card uses text nodes and a click selects the exact ID and tells the conversation", async () => {
  const calls: Invocation[] = [];
  const w = await widget((call) => {
    calls.push(call);
    return result(report);
  });
  const resolution = {
    mode: "selection",
    resolution: {
      status: "ambiguous",
      candidates: [{ ...media, id: "ig_media_1" }, media],
      moreMatches: false,
      report: null,
    },
  };
  w.receive(resolution, true);
  assert.equal(w.nodes.get("candidates")?.children.length, 0);
  w.receive(resolution);
  assert.equal(calls.length, 0);
  const candidateList = w.nodes.get("candidates");
  assert.ok(candidateList);
  const candidates = candidateList.children;
  assert.equal(candidates[1].children[0].textContent, media.caption);
  candidates[1].children[0].trigger("click");
  await w.settle();
  assert.deepEqual(
    calls.map((c) => c.name),
    ["get_media_report"],
  );
  assert.equal(calls[0].arguments.mediaId, media.id);
  const sent = w.messages.find((m) => m.method === "ui/message")?.params as {
    content: { text: string }[];
  };
  assert.ok(sent.content[0].text.includes(media.id));
  assert.ok(!sent.content[0].text.includes(media.caption));
  assert.ok(
    w.nodes.get("metrics")?.children.some((row) => row.children[1].textContent.startsWith("0")),
  );
  assert.ok(
    w.nodes.get("metrics")?.children.some((row) => row.children[1].textContent === "Нет данных"),
  );
});
test("A lost media refresh response is inspected before another write and is isolated from collection", async () => {
  const calls: Invocation[] = [];
  const w = await widget((call) => {
    calls.push(call);
    if (call.name === "refresh_media")
      return { isError: true, structuredContent: { code: "RESPONSE_UNCERTAIN" } };
    return result(call.name === "get_sync_status" ? { status: "completed" } : report);
  });
  w.receive({
    mode: "selection",
    resolution: { status: "matched", report, candidates: [], moreMatches: false },
  });
  w.nodes.get("refresh")?.trigger("click");
  await w.settle();
  w.nodes.get("refresh")?.trigger("click");
  await w.settle();
  assert.deepEqual(
    calls.map((c) => c.name),
    ["refresh_media", "get_sync_status", "get_media_report"],
  );
  assert.equal(
    calls[1].arguments.operationId,
    (calls[0].arguments.body as { operationId: string }).operationId,
  );
});
