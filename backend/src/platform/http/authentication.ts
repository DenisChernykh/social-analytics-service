import type { MiddlewareHandler } from "hono";
import { sha256 } from "../crypto/secrets";
import type { HttpEnv } from "./environment";
import { problem } from "./problem";

export const authenticate: MiddlewareHandler<HttpEnv> = async (c, next) => {
  const expected = c.env.API_KEY;
  if (!expected || expected.length < 32) {
    return problem(c, 503, "CONFIGURATION_REQUIRED", "Configure the personal API key locally.");
  }
  const authorization = c.req.header("Authorization");
  const provided = authorization?.match(/^Bearer ([^\s]{32,512})$/)?.[1];
  if (!provided || (await sha256(provided)) !== (await sha256(expected))) {
    return problem(c, 401, "UNAUTHENTICATED", "A valid personal bearer key is required.");
  }
  await next();
};
