import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  activityReportSchema,
  createInsightModule,
} from "../modules/account-insights/public-contracts";
import {
  accountSchema,
  createAnalyticsModule,
  summarySchema,
} from "../modules/analytics/public-contracts";
import type { CollectionCommands } from "../modules/collection";
import { createCollectionModule } from "../modules/collection/public-contracts";
import { createCommentModule } from "../modules/community/public-contracts";
import { createContentModule } from "../modules/content/public-contracts";
import { createInstagramOperations, type InstagramModuleOptions } from "../modules/instagram";
import {
  createCommentWebhookModule,
  createInstagramModule,
} from "../modules/instagram/public-contracts";
import { createReviewModule } from "../modules/reviews";
import type { RuntimeBindings } from "../platform/config/runtime-config";
import { authenticate } from "../platform/http/authentication";
import type { HttpEnv } from "../platform/http/environment";
import { applicationProblem, errorResponses, problem } from "../platform/http/problem";
import { ApplicationError } from "../shared/application/application-error";
import { featureOptions } from "./create-features";
import { durableCollectionCommands } from "./durable-collection";
import { registerPublicInformation } from "./public-information";

export function createApp(
  options: {
    instagram?: InstagramModuleOptions;
    clock?: () => number;
    collectionCommands?: (env: RuntimeBindings) => CollectionCommands;
  } = {},
) {
  const app = new OpenAPIHono<HttpEnv>();
  const instagramOptions = {
    ...options.instagram,
    clock: options.clock ?? options.instagram?.clock,
  };
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => problem(c, 413, "PAYLOAD_TOO_LARGE", "The request body exceeds 32 KiB."),
    }),
  );
  app.use("/api/*", (c, next) =>
    c.req.path === "/api/instagram/oauth/callback" && c.req.method === "GET"
      ? next()
      : authenticate(c, next),
  );
  app.use("/api/*", async (c, next) => {
    if (
      ["POST", "PATCH"].includes(c.req.method) &&
      c.req.path !== "/api/instagram/oauth/start" &&
      c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    ) {
      return problem(
        c,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Use application/json for the request body.",
      );
    }
    await next();
  });
  app.openapi(
    createRoute({
      method: "get",
      path: "/health",
      operationId: "health",
      tags: ["System"],
      responses: {
        200: {
          description: "Worker availability; does not assert Instagram connectivity.",
          content: {
            "application/json": {
              schema: z.object({ status: z.literal("ok"), revision: z.string() }),
            },
          },
        },
        ...errorResponses,
      },
    }),
    (c) => c.json({ status: "ok" as const, revision: c.env.BUILD_REVISION }, 200),
  );
  registerPublicInformation(app);
  app.route("/", createInstagramModule(instagramOptions).router);
  const features = featureOptions(instagramOptions, options.clock);
  app.route("/", createCommentWebhookModule(features.commentWebhookOptions).router);
  app.route(
    "/",
    createAnalyticsModule({
      reader: (env) => createInstagramOperations(env, instagramOptions),
      clock: options.clock,
    }).router,
  );
  app.route(
    "/",
    createCollectionModule(
      features.collectionOptions,
      options.collectionCommands ?? durableCollectionCommands,
    ).router,
  );
  app.route("/", createInsightModule(features.insightsOptions).router);
  app.route("/", createContentModule(features.contentOptions).router);
  app.route("/", createCommentModule(features.commentOptions).router);
  app.route(
    "/",
    createReviewModule(features.reviewOptions, [activityReportSchema, summarySchema, accountSchema])
      .router,
  );
  app.openAPIRegistry.registerComponent("securitySchemes", "personalKey", {
    type: "http",
    scheme: "bearer",
    description:
      "Personal deployment key. This backend serves a single owner with multiple social accounts.",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Social Analytics API",
      version: "0.1.0",
      description:
        "Official Instagram API collection, snapshots, search and derived analytics. Personal service; timestamps are UTC milliseconds.",
    },
  });
  app.notFound((c) => problem(c, 404, "NOT_FOUND", "The requested resource was not found."));
  app.onError((error, c) => {
    if (error instanceof ApplicationError) return applicationProblem(c, error);
    if (error instanceof HTTPException && error.status === 400)
      return problem(c, 400, "VALIDATION_FAILED", "The request contains invalid JSON.");
    // Do not log upstream exceptions: OAuth URLs and messages can include secrets.
    return problem(c, 500, "INTERNAL_ERROR", "The request could not be completed.");
  });
  return app;
}
