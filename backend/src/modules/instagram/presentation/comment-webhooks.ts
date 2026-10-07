import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { RuntimeBindings } from "../../../platform/config/runtime-config";
import { sha256 } from "../../../platform/crypto/secrets";
import type { HttpEnv } from "../../../platform/http/environment";
import { errorResponses, problem } from "../../../platform/http/problem";
import type {
  CommentNotification,
  InstagramCommentWebhooks,
} from "../application/comment-webhooks";

const identifier = z.string().regex(/^\d{1,80}$/);
const change = z.object({ field: z.string(), value: z.unknown() });
const entry = z.object({
  id: identifier,
  time: z.number().int().nonnegative().max(10_000_000_000),
  changes: z.array(change).max(100).optional(),
  field: z.string().optional(),
  value: z.unknown().optional(),
});
const payloadSchema = z.object({ object: z.literal("instagram"), entry: z.array(entry).max(100) });
const valueSchema = z.object({
  id: identifier,
  media: z.object({ id: identifier }),
  parent_id: identifier.nullish(),
  text: z.string().max(20000).optional(),
});

export function createCommentWebhooksHttp(
  operations: (env: RuntimeBindings) => InstagramCommentWebhooks,
) {
  const router = new OpenAPIHono<HttpEnv>();
  router.openAPIRegistry.registerPath({
    method: "get",
    path: "/webhooks/instagram/comments",
    operationId: "verifyInstagramCommentsWebhook",
    tags: ["Instagram webhooks"],
    responses: {
      200: {
        description: "Meta callback challenge after verify-token validation.",
        content: { "text/plain": { schema: z.string() } },
      },
      ...errorResponses,
    },
  });
  router.get("/webhooks/instagram/comments", async (c) => {
    const expected = c.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (!expected || expected.length < 32)
      return problem(c, 503, "CONFIGURATION_REQUIRED", "Configure the webhook verify token.");
    const challenge = c.req.query("hub.challenge");
    const provided = c.req.query("hub.verify_token");
    if (
      c.req.query("hub.mode") !== "subscribe" ||
      !provided ||
      provided.length > 512 ||
      !challenge ||
      !/^\d{1,30}$/.test(challenge) ||
      (await sha256(provided)) !== (await sha256(expected))
    )
      return problem(c, 403, "WEBHOOK_VERIFICATION_FAILED", "Webhook verification failed.");
    return c.text(challenge);
  });
  // Document the body independently: runtime JSON validation must happen after
  // signature verification over the exact incoming bytes, before normalization.
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/webhooks/instagram/comments",
    operationId: "receiveInstagramCommentsWebhook",
    tags: ["Instagram webhooks"],
    request: {
      body: { required: true, content: { "application/json": { schema: payloadSchema } } },
    },
    responses: {
      200: {
        description:
          "Signed notification accepted; schedules reconciliation without saving text or claiming a publication timestamp.",
        content: { "application/json": { schema: z.object({ received: z.literal(true) }) } },
      },
      ...errorResponses,
    },
  });
  router.post("/webhooks/instagram/comments", async (c) => {
    const secret = c.env.INSTAGRAM_CLIENT_SECRET;
    if (!secret)
      return problem(
        c,
        503,
        "CONFIGURATION_REQUIRED",
        "Configure Instagram before receiving webhooks.",
      );
    const body = await c.req.arrayBuffer();
    if (!(await operations(c.env).verify(body, c.req.header("X-Hub-Signature-256") ?? "")))
      return problem(c, 403, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature is invalid.");
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return problem(c, 400, "VALIDATION_FAILED", "The webhook body is invalid.");
    }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success)
      return problem(c, 400, "VALIDATION_FAILED", "The webhook payload is invalid.");
    const notifications: CommentNotification[] = [];
    for (const entry of parsed.data.entry) {
      for (const update of entry.changes ??
        (entry.field ? [{ field: entry.field, value: entry.value }] : [])) {
        if (update.field !== "comments") continue;
        const value = valueSchema.safeParse(update.value);
        if (!value.success)
          return problem(c, 400, "VALIDATION_FAILED", "The comments notification is invalid.");
        notifications.push({
          accountExternalId: entry.id,
          mediaExternalId: value.data.media.id,
          commentId: value.data.id,
          parentId: value.data.parent_id ?? null,
          sentAt: entry.time * 1000,
          text: value.data.text ?? null,
        });
        if (notifications.length > 100)
          return problem(c, 400, "VALIDATION_FAILED", "The notification batch is too large.");
      }
    }
    return c.json(await operations(c.env).receive(notifications));
  });
  router.openapi(
    createRoute({
      method: "post",
      path: "/api/accounts/{accountId}/comments/webhook/subscribe",
      operationId: "subscribeInstagramCommentsWebhook",
      tags: ["Instagram webhooks"],
      security: [{ personalKey: [] }],
      request: {
        params: z.object({ accountId: z.string().min(1).max(150) }),
        body: {
          required: true,
          content: { "application/json": { schema: z.object({}).strict() } },
        },
      },
      responses: {
        200: {
          description:
            "Account comments subscription accepted by Meta; real delivery must still be confirmed.",
          content: {
            "application/json": {
              schema: z.object({
                subscribed: z.literal(true),
              }),
            },
          },
        },
        ...errorResponses,
      },
    }),
    async (c) => c.json(await operations(c.env).subscribe(c.req.valid("param").accountId), 200),
  );
  return router;
}
