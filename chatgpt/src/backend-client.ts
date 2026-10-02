import type { z } from "zod";

export const BACKEND_ORIGIN = "https://api.social-insights.workers.dev";
export type BackendFetch = (request: Request) => Promise<Response>;
export type SiteEnvironment = { SOCIAL_API_KEY?: string; SOCIAL_OWNER_EMAIL?: string };

export class BackendError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code = "BACKEND_UNAVAILABLE", status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function requireOwner(request: Request, env: SiteEnvironment) {
  const owner = env.SOCIAL_OWNER_EMAIL?.trim().toLowerCase();
  const visitor = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!owner || !env.SOCIAL_API_KEY)
    throw new BackendError(
      "Серверное подключение Social Analytics ещё не настроено.",
      "NOT_CONFIGURED",
      503,
    );
  // Sites ingress authenticates the user and overwrites this identity header.
  // The bundle must only be deployed behind that ingress, without a workers.dev route.
  if (visitor !== owner)
    throw new BackendError(
      "Статистика доступна только владельцу после входа в ChatGPT.",
      "FORBIDDEN",
      403,
    );
  return env.SOCIAL_API_KEY;
}

async function boundedJson(response: Response): Promise<unknown> {
  let bytes = 0;
  const body = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > 4_194_304) throw new Error("Response too large");
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body).json();
}

export function createBackendClient(token: string, fetchBackend: BackendFetch) {
  return {
    async request<T>(
      path: string,
      schema: z.ZodType<T>,
      body?: unknown,
      method = "GET",
    ): Promise<T> {
      const url = new URL(path, BACKEND_ORIGIN);
      if (
        url.origin !== BACKEND_ORIGIN ||
        !url.pathname.startsWith("/api/") ||
        url.pathname.includes("/instagram/")
      )
        throw new BackendError("Недопустимый маршрут адаптера.", "INVALID_ROUTE", 400);
      const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      let response: Response;
      try {
        response = await fetchBackend(
          new Request(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "manual",
            signal: AbortSignal.timeout(method === "POST" ? 150_000 : 20_000),
          }),
        );
      } catch {
        throw new BackendError(
          method === "GET"
            ? "Backend недоступен. Повторите чтение позже."
            : "Ответ не получен: действие могло сохраниться. Для сбора сначала проверьте operationId; для названия перечитайте публикацию.",
          "RESPONSE_UNCERTAIN",
        );
      }
      if (!response.ok) {
        let code = response.status === 401 ? "UNAUTHORIZED" : "BACKEND_ERROR";
        try {
          const data = (await boundedJson(response)) as { code?: unknown };
          if (typeof data.code === "string" && /^[A-Z_]{1,64}$/.test(data.code)) code = data.code;
        } catch {
          /* Do not return upstream payload, stack traces or request URLs. */
        }
        throw new BackendError(
          code === "INSTAGRAM_RATE_LIMITED"
            ? "Meta ограничила частоту запросов. Сделайте паузу перед продолжением сбора."
            : `Запрос не выполнен (HTTP ${response.status}, ${code}).`,
          code,
          response.status,
        );
      }
      try {
        return schema.parse(await boundedJson(response));
      } catch {
        throw new BackendError(
          "Ответ backend не соответствует сохранённому контракту. Перед повторной записью проверьте результат.",
          "INVALID_RESPONSE",
        );
      }
    },
  };
}
