import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BackendError, type createBackendClient } from "./backend-client.ts";
import * as contract from "./contract.ts";
import { WIDGET_HTML, WIDGET_URI } from "./widget.ts";

type Api = ReturnType<typeof createBackendClient>;
type Run = (operation: (api: Api) => Promise<Record<string, unknown>>) => Promise<CallToolResult>;
const id = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[A-Za-z0-9_-]+$/);
export const panelResponse = z.object({
  mode: z.literal("status"),
  accounts: contract.accountsResponse.shape.accounts,
  selectedAccountId: z.string().nullable(),
  collection: contract.collectionStatusResponse.nullable(),
  history: z.object({
    observedFrom: z.number().nullable(),
    sampled: z.number(),
    beginningKnown: z.literal(false),
  }),
});
export const choiceResponse = z.object({
  mode: z.literal("selection"),
  resolution: contract.resolveResponse,
});

export function registerUiTools(server: McpServer, run: Run) {
  server.registerResource(
    "social-analytics-card",
    WIDGET_URI,
    { mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: "text/html;profile=mcp-app",
          text: WIDGET_HTML,
          _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } },
        },
      ],
    }),
  );
  const ui = { ui: { resourceUri: WIDGET_URI, visibility: ["model", "app"] } };
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    "open_social_analytics",
    {
      title: "Состояние Social Analytics",
      description:
        "Небольшая карточка в ChatGPT: аккаунты, свежесть и подтверждённые полные проходы, отдельные действия сбора и расписания. Только чтение; открытие не запускает сбор. Клиент загружает UI отдельно от JSON результата: отсутствие HTML в результате не означает сбой карточки. Сообщай о недоступности UI только при явной ошибке клиента или подтверждении пользователя; тогда верни состояния текстом.",
      inputSchema: z.object({ accountId: id.optional() }),
      outputSchema: z.object({ data: panelResponse }),
      annotations,
      _meta: ui,
    },
    ({ accountId }) =>
      run(async (api) => {
        const { accounts } = await api.request("/api/accounts", contract.accountsResponse);
        const selected = accountId
          ? accounts.find((a) => a.id === accountId)
          : accounts.length === 1
            ? accounts[0]
            : undefined;
        if (accountId && !selected) throw new BackendError("Аккаунт не найден.", "NOT_FOUND", 404);
        if (!selected)
          return {
            data: {
              mode: "status",
              accounts,
              selectedAccountId: null,
              collection: null,
              history: { observedFrom: null, sampled: 0, beginningKnown: false },
            },
          };
        const [collection, history] = await Promise.all([
          api.request(`/api/accounts/${selected.id}/collection`, contract.collectionStatusResponse),
          api.request(
            `/api/accounts/${selected.id}/history?limit=100`,
            contract.accountHistoryResponse,
          ),
        ]);
        return {
          data: {
            mode: "status",
            accounts,
            selectedAccountId: selected.id,
            collection,
            history: {
              observedFrom: history.items.length
                ? Math.min(...history.items.map((i) => i.observedAt))
                : null,
              sampled: history.items.length,
              beginningKnown: false,
            },
          },
        };
      }),
  );
  server.registerTool(
    "choose_media",
    {
      title: "Выбрать публикацию",
      description:
        "Карточка кандидатов по исходному названию или ссылке. Поиск выполняет backend; ambiguous требует отдельного выбора владельца и точного ID. Нет автоматического выбора первого результата. Клиент загружает UI отдельно от JSON; не объявляй карточку недоступной из-за отсутствия HTML в результате. При явной ошибке клиента или подтверждении пользователя покажи кандидатов в разговоре.",
      inputSchema: z.object({ query: z.string().min(1).max(200), accountId: id.optional() }),
      outputSchema: z.object({ data: choiceResponse }),
      annotations,
      _meta: ui,
    },
    (args) =>
      run(async (api) => {
        const query = new URLSearchParams({
          query: args.query,
          ...(args.accountId ? { accountId: args.accountId } : {}),
        });
        return {
          data: {
            mode: "selection",
            resolution: await api.request(`/api/reports/media?${query}`, contract.resolveResponse),
          },
        };
      }),
  );
}
