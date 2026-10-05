import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApplicationError, ErrorCode } from "../../shared/application/application-error";
import type { HttpEnv } from "./environment";

export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
    code: z.string(),
    requestId: z.string(),
  })
  .openapi("ProblemDetails");

const statusByCode: Record<ErrorCode, ContentfulStatusCode> = {
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  CONFIGURATION_REQUIRED: 503,
  INSTAGRAM_AUTH_EXPIRED: 409,
  INSTAGRAM_PERMISSION_REQUIRED: 403,
  INSTAGRAM_RATE_LIMITED: 429,
  INSTAGRAM_UNAVAILABLE: 502,
  INVALID_OAUTH_STATE: 400,
  OAUTH_DENIED: 400,
  SYNC_IN_PROGRESS: 409,
  SYNC_LEASE_EXPIRED: 409,
  COLLECTION_EXPIRED: 409,
  INTERNAL_ERROR: 500,
  OPERATION_CONFLICT: 409,
};

export function problem(
  c: Context<HttpEnv>,
  status: ContentfulStatusCode,
  code: string,
  detail: string,
): Response {
  const requestId = c.get("requestId");
  return c.json(
    {
      type: `urn:social-analytics:problem:${code.toLowerCase().replaceAll("_", "-")}`,
      title: code.toLowerCase().replaceAll("_", " "),
      status,
      detail,
      code,
      requestId,
      instance: `${new URL(c.req.url).pathname}#${requestId}`,
    },
    status,
    { "Content-Type": "application/problem+json" },
  );
}

export function applicationProblem(c: Context<HttpEnv>, error: ApplicationError): Response {
  return problem(c, statusByCode[error.code], error.code, error.message);
}

export const errorResponses = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 415, 429, 500, 502, 503].map((status) => [
    status,
    {
      description: "Problem Details with a stable code; no upstream tokens or error payloads.",
      content: { "application/problem+json": { schema: problemSchema } },
    },
  ]),
);
