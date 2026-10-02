import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { BackendFetch, SiteEnvironment } from "./backend-client.ts";
import { createServer, VERSION } from "./server.ts";

async function boundedRequest(request: Request): Promise<Request | null> {
  const limit = 65_536;
  if (Number(request.headers.get("Content-Length")) > limit) return null;
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

export function createWorker(fetchBackend: BackendFetch = fetch) {
  return {
    async fetch(request: Request, env: SiteEnvironment): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(
          `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Social Analytics</title><h1>Social Analytics</h1><p>Личная статистика ваших соцсетей в ChatGPT. Первая готовая интеграция — Instagram. Другие соцсети пока не подключены. Версия ${VERSION}.</p><p>Установите связанный плагин в ChatGPT: Плагины → Личные → Созданные вами → Social Analytics → Установить → Подключить.</p><p>Напишите: «Мне нужна статистика по ролику», добавив название, подпись или ссылку. При нескольких совпадениях выберите публикацию.</p><p>Отчёты показывают сохранённые снимки и время сбора. Новую статистику собирайте отдельной просьбой. Недоступные метрики обозначаются как отсутствие данных.</p></html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
              "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            },
          },
        );
      }
      if (url.pathname !== "/mcp") return new Response("Не найдено", { status: 404 });
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin)
        return new Response("Недопустимый источник запроса", { status: 403 });
      if (request.method === "POST") {
        const bounded = await boundedRequest(request);
        if (!bounded) return new Response("Слишком большой запрос", { status: 413 });
        request = bounded;
      }

      // Discovery is harmless behind private Sites ingress; data calls require owner identity.
      const server = createServer(request, env, fetchBackend);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
      } catch {
        return Response.json(
          { error: "MCP_REQUEST_FAILED" },
          { status: 500, headers: { "Cache-Control": "no-store" } },
        );
      } finally {
        await server.close();
      }
    },
  };
}

export default createWorker();
