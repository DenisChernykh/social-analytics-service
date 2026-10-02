import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import { randomState, sha256 } from "../../../platform/crypto/secrets";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type { InstagramConnections } from "../application/connections";

const connectionSchema = z
  .object({
    accountId: z.string(),
    expiresAt: z.number(),
    refreshedAt: z.number(),
    scopes: z.array(z.string()),
  })
  .openapi("InstagramConnection");
const secured = [{ personalKey: [] }];

export function createInstagramHttp(
  createOperations: (env: RuntimeBindings) => InstagramConnections,
) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/instagram/oauth/start",
      operationId: "startInstagramAuthorization",
      tags: ["Instagram"],
      security: secured,
      request: { query: z.object({ comments: z.enum(["true", "false"]).default("false") }) },
      responses: {
        200: {
          description:
            "Open authorizationUrl in a browser. This state is single use and expires in ten minutes.",
          content: {
            "application/json": {
              schema: z.object({ authorizationUrl: z.url(), expiresAt: z.number() }),
            },
          },
        },
        ...errorResponses,
      },
    }),
    async (c) => {
      const state = randomState();
      return c.json(
        await createOperations(c.env).start(
          state,
          await sha256(state),
          c.req.valid("query").comments === "true",
        ),
        200,
      );
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/instagram/oauth/callback",
      operationId: "completeInstagramAuthorization",
      tags: ["Instagram"],
      request: {
        query: z.object({
          code: z.string().min(1).max(16000).optional(),
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          error: z.string().max(200).optional(),
          error_reason: z.string().max(200).optional(),
          error_description: z.string().max(2000).optional(),
        }),
      },
      responses: {
        200: {
          description: "Connected account. Access tokens are never returned.",
          content: {
            "application/json": {
              schema: z.object({
                accountId: z.string(),
                username: z.string(),
                expiresAt: z.number(),
              }),
            },
          },
        },
        ...errorResponses,
      },
    }),
    async (c) => {
      const input = c.req.valid("query");
      return c.json(
        await createOperations(c.env).callback({
          stateHash: await sha256(input.state),
          code: input.code,
          denied: !!input.error,
        }),
        200,
      );
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/api/instagram/connections",
      operationId: "listInstagramConnections",
      tags: ["Instagram"],
      security: secured,
      responses: {
        200: {
          description: "Connection status without credentials.",
          content: {
            "application/json": { schema: z.object({ connections: z.array(connectionSchema) }) },
          },
        },
        ...errorResponses,
      },
    }),
    async (c) => c.json({ connections: await createOperations(c.env).list() }, 200),
  );

  router.openapi(
    createRoute({
      method: "delete",
      path: "/api/instagram/connections/{accountId}",
      operationId: "disconnectInstagram",
      tags: ["Instagram"],
      security: secured,
      request: { params: z.object({ accountId: z.string().min(1).max(100) }) },
      responses: {
        204: {
          description:
            "Delete the locally stored token; retain statistics and titles. This does not revoke Meta permissions.",
        },
        ...errorResponses,
      },
    }),
    async (c) => {
      await createOperations(c.env).disconnect(c.req.valid("param").accountId);
      return c.body(null, 204);
    },
  );
  return router;
}
