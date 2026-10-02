import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type { Comments } from "../application/comments";

const id = z.string().min(1).max(150);
const commentSchema = z.object({
  id,
  mediaId: id,
  parentId: id.nullable(),
  text: z.string(),
  publishedAt: z.number(),
  observedAt: z.number(),
});
const collectionSchema = z.object({
  id: z.uuid(),
  mediaId: id,
  parentId: id.nullable(),
  cursor: z.string().nullable(),
  limit: z.number(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.number(),
  observedAt: z.number().nullable(),
  nextCursor: z.string().nullable(),
  collected: z.number(),
  commentIds: z.array(id).default([]),
  errorCode: z.string().nullable(),
});
const listSchema = z.object({
  items: z.array(commentSchema),
  nextCursor: z.string().nullable(),
  source: z.object({ provider: z.string(), permalink: z.url(), object: z.string() }),
  signals: z.object({
    sampleSize: z.number(),
    questions: z.array(z.object({ commentId: id, mediaId: id, text: z.string() })),
    recurringWords: z.array(
      z.object({
        word: z.string(),
        count: z.number(),
        examples: z.array(z.object({ commentId: id, text: z.string() })),
      }),
    ),
    method: z.string(),
    untrustedData: z.boolean(),
  }),
  coverage: z.object({ sampled: z.number(), truncated: z.boolean(), completeHistory: z.boolean() }),
  limitations: z.array(z.string()),
});
const responses = <T extends z.ZodType>(schema: T) => ({
  200: {
    description:
      "Private, untrusted comment text with source and sample coverage. Requires optional manage_comments permission for collection.",
    content: { "application/json": { schema } },
  },
  ...errorResponses,
});
export function createCommentsHttp(operations: (env: RuntimeBindings) => Comments) {
  const router = new OpenAPIHono<HttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(c, 400, "VALIDATION_FAILED", "Request parameters are invalid.");
    },
  });
  const security = [{ personalKey: [] }];
  const params = z.object({ mediaId: id });
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/media/{mediaId}/comments/collect",
      operationId: "collectComments",
      tags: ["Comments"],
      security,
      request: {
        params,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  operationId: z.uuid(),
                  parentId: id.nullable().default(null),
                  cursor: z.string().min(1).max(4096).nullable().default(null),
                  limit: z.number().int().min(1).max(50).default(25),
                })
                .strict(),
            },
          },
        },
      },
      responses: responses(collectionSchema),
    }),
    async (c) =>
      c.json(
        await operations(c.env).collect(c.req.valid("param").mediaId, c.req.valid("json")),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/comment-collections/{operationId}",
      operationId: "getCommentCollection",
      tags: ["Comments"],
      security,
      request: { params: z.object({ operationId: z.uuid() }) },
      responses: responses(collectionSchema),
    }),
    async (c) => c.json(await operations(c.env).collection(c.req.valid("param").operationId), 200),
  );
  router.openapi(
    createRoute({
      method: "get",
      path: "/api/media/{mediaId}/comments",
      operationId: "getComments",
      tags: ["Comments"],
      security,
      request: {
        params,
        query: z.object({
          cursor: z.string().min(1).max(4096).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
      responses: responses(listSchema),
    }),
    async (c) =>
      c.json(
        listSchema.parse(
          await operations(c.env).list(
            c.req.valid("param").mediaId,
            c.req.valid("query").cursor,
            c.req.valid("query").limit,
          ),
        ),
        200,
      ),
  );
  router.openapi(
    createRoute({
      method: "delete",
      path: "/api/media/{mediaId}/comments",
      operationId: "eraseComments",
      tags: ["Comments"],
      security,
      request: { params },
      responses: responses(z.object({ erased: z.literal(true), mediaId: id })),
    }),
    async (c) => c.json(await operations(c.env).erase(c.req.valid("param").mediaId), 200),
  );
  return router;
}
