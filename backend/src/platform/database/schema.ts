import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    username: text("username").notNull(),
    accountType: text("account_type").notNull(),
    connectedAt: integer("connected_at").notNull(),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [uniqueIndex("accounts_platform_external").on(table.platform, table.externalId)],
);

export const instagramConnections = sqliteTable("instagram_connections", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  encryptedToken: text("encrypted_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  refreshedAt: integer("refreshed_at").notNull(),
  scopes: text("scopes").notNull(),
});

export const oauthAttempts = sqliteTable("oauth_attempts", {
  stateHash: text("state_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    caption: text("caption").notNull(),
    title: text("title"),
    titleSearch: text("title_search").notNull().default(""),
    searchText: text("search_text").notNull(),
    mediaType: text("media_type").notNull(),
    productType: text("product_type").notNull(),
    permalink: text("permalink").notNull(),
    publishedAt: integer("published_at").notNull(),
    durationSeconds: real("duration_seconds"),
    durationSource: text("duration_source"),
    updatedAt: integer("updated_at").notNull(),
    contextJson: text("context_json"),
    metadataJson: text("metadata_json"),
    firstDiscoveredAt: integer("first_discovered_at"),
    discoverySource: text("discovery_source"),
    unavailableUntil: integer("unavailable_until").notNull().default(0),
    unavailableCode: text("unavailable_code"),
  },
  (table) => [
    uniqueIndex("media_account_external").on(table.accountId, table.externalId),
    index("media_account_published").on(table.accountId, table.publishedAt),
  ],
);

export const mediaSnapshots = sqliteTable(
  "media_snapshots",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    observedAt: integer("observed_at").notNull(),
    apiVersion: text("api_version").notNull(),
    metricsJson: text("metrics_json").notNull(),
    storyInsightsJson: text("story_insights_json"),
    profileActivityJson: text("profile_activity_json"),
    operationId: text("operation_id"),
    provenanceJson: text("provenance_json"),
  },
  (table) => [
    index("snapshots_media_time").on(table.mediaId, table.observedAt),
    index("snapshots_operation").on(table.operationId),
  ],
);

export const accountSnapshots = sqliteTable(
  "account_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    observedAt: integer("observed_at").notNull(),
    followersCount: integer("followers_count"),
    mediaCount: integer("media_count"),
    provenanceJson: text("provenance_json"),
  },
  (table) => [index("account_snapshots_time").on(table.accountId, table.observedAt)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    inputCursor: text("input_cursor"),
    pageSize: integer("page_size").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    leaseExpiresAt: integer("lease_expires_at").notNull(),
    nextCursor: text("next_cursor"),
    mediaCount: integer("media_count").notNull().default(0),
    usefulValues: integer("useful_values"),
    coverageState: text("coverage_state"),
    firstUsefulAt: integer("first_useful_at"),
    lastUsefulAt: integer("last_useful_at"),
    errorCode: text("error_code"),
    kind: text("kind").notNull().default("page"),
    targetMediaId: text("target_media_id"),
  },
  (table) => [index("sync_account_status").on(table.accountId, table.status)],
);

export const syncLeases = sqliteTable("sync_leases", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const collectionJobs = sqliteTable(
  "collection_jobs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    targetMediaId: text("target_media_id"),
    automatic: integer("automatic", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull(),
    cursor: text("cursor"),
    pages: integer("pages").notNull().default(0),
    collected: integer("collected").notNull().default(0),
    mediaProcessed: integer("media_processed").notNull().default(0),
    skippedMedia: integer("skipped_media").notNull().default(0),
    skippedPeriods: integer("skipped_periods").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    lastSuccessAt: integer("last_success_at"),
    errorCode: text("error_code"),
    latencyOrigin: text("latency_origin"),
    httpAttemptsSinceAt: integer("http_attempts_since_at"),
    firstAttemptAt: integer("first_attempt_at"),
    lastAttemptAt: integer("last_attempt_at"),
    firstUsefulObservationAt: integer("first_useful_observation_at"),
    lastUsefulObservationAt: integer("last_useful_observation_at"),
    httpAttempts: integer("http_attempts").notNull().default(0),
    lastStepDurationMs: integer("last_step_duration_ms"),
    lastStepHttpAttempts: integer("last_step_http_attempts"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
  },
  (table) => [
    index("collection_due").on(table.status, table.nextAttemptAt),
    index("collection_comment_target").on(table.targetMediaId, table.status),
    index("collection_account_origin").on(
      table.accountId,
      table.origin,
      table.status,
      table.startedAt,
    ),
  ],
);

export const collectionSchedules = sqliteTable("collection_schedules", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  discoveryMinutes: integer("discovery_minutes").notNull().default(60),
  timeZone: text("time_zone").notNull().default("UTC"),
  nextCatalogueAt: integer("next_catalogue_at").notNull().default(0),
  nextDiscoveryAt: integer("next_discovery_at").notNull(),
  nextStoriesAt: integer("next_stories_at").notNull(),
  nextInsightsAt: integer("next_insights_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
  lastSuccessAt: integer("last_success_at"),
  errorCode: text("error_code"),
  failures: integer("failures").notNull().default(0),
  retryAt: integer("retry_at").notNull().default(0),
  claimToken: text("claim_token"),
  claimExpiresAt: integer("claim_expires_at"),
});

export const accountInsights = sqliteTable(
  "account_insights",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    signature: text("signature").notNull(),
    observedAt: integer("observed_at").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    index("account_insights_query_time").on(table.accountId, table.signature, table.observedAt),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    text: text("text").notNull(),
    publishedAt: integer("published_at").notNull(),
    observedAt: integer("observed_at").notNull(),
    authorId: text("author_id"),
    authorUsername: text("author_username"),
    likeCount: integer("like_count"),
    hidden: integer("hidden", { mode: "boolean" }),
  },
  (table) => [index("comments_media_time").on(table.mediaId, table.publishedAt)],
);

export const commentCollections = sqliteTable(
  "comment_collections",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    signature: text("signature").notNull(),
    observedAt: integer("observed_at").notNull(),
    resultJson: text("result_json").notNull(),
    jobId: text("job_id"),
    parentId: text("parent_id"),
    pageFingerprint: text("page_fingerprint"),
  },
  (table) => [
    index("comment_collections_media_time").on(table.mediaId, table.observedAt),
    index("comment_collections_job_page").on(table.jobId, table.parentId, table.pageFingerprint),
  ],
);

export const commentMediaState = sqliteTable("comment_media_state", {
  mediaId: text("media_id")
    .primaryKey()
    .references(() => media.id, { onDelete: "cascade" }),
  lastAttemptAt: integer("last_attempt_at"),
  lastCompleteAt: integer("last_complete_at"),
  nextRefreshAt: integer("next_refresh_at").notNull().default(0),
  lastCommentsCount: integer("last_comments_count"),
  eventGeneration: integer("event_generation").notNull().default(0),
  processedGeneration: integer("processed_generation").notNull().default(0),
  lastWebhookAt: integer("last_webhook_at"),
  omittedBranches: integer("omitted_branches").notNull().default(0),
  errorCode: text("error_code"),
  unavailableUntil: integer("unavailable_until").notNull().default(0),
});

export const instagramApiState = sqliteTable("instagram_api_state", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  apiVersion: text("api_version").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
  usagePercent: real("usage_percent"),
  usageObservedAt: integer("usage_observed_at"),
  recordedRequests: integer("recorded_requests").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  responses: integer("responses").notNull().default(0),
  failuresBeforeResponse: integer("failures_before_response").notNull().default(0),
  timeouts: integer("timeouts").notNull().default(0),
  rateLimitedResponses: integer("rate_limited_responses").notNull().default(0),
  accountingSinceAt: integer("accounting_since_at"),
  usageHeadersJson: text("usage_headers_json"),
  sinceAt: integer("since_at").notNull(),
  observedAt: integer("observed_at").notNull(),
});

export const instagramMetricSupport = sqliteTable(
  "instagram_metric_support",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    apiVersion: text("api_version").notNull(),
    objectId: text("object_id").notNull(),
    signature: text("signature").notNull(),
    metric: text("metric").notNull(),
    observedAt: integer("observed_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("instagram_metric_support_scope").on(
      table.accountId,
      table.apiVersion,
      table.objectId,
      table.signature,
    ),
    index("instagram_metric_support_expiry").on(table.expiresAt),
  ],
);

export const commentWebhookState = sqliteTable("comment_webhook_state", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  subscriptionConfirmedAt: integer("subscription_confirmed_at"),
  lastReceivedAt: integer("last_received_at"),
  lastEventAt: integer("last_event_at"),
});

export const commentWebhookEvents = sqliteTable("comment_webhook_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  externalMediaId: text("external_media_id").notNull(),
  mediaId: text("media_id").references(() => media.id, { onDelete: "cascade" }),
  receivedAt: integer("received_at").notNull(),
});

export const businessRecords = sqliteTable("business_records", {
  id: text("id").primaryKey(),
  mediaId: text("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  recordedAt: integer("recorded_at").notNull(),
  payloadJson: text("payload_json").notNull(),
});
export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  planJson: text("plan_json").notNull(),
  conclusionJson: text("conclusion_json"),
  assignmentsJson: text("assignments_json").notNull().default("[]"),
});
export const storySequences = sqliteTable("story_sequences", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  updatedAt: integer("updated_at").notNull(),
  payloadJson: text("payload_json").notNull(),
});

export const instagramHttpAttempts = sqliteTable(
  "instagram_http_attempts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    operationId: text("operation_id"),
    objectId: text("object_id"),
    requestedAt: integer("requested_at").notNull(),
    receivedAt: integer("received_at"),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => [
    index("instagram_attempt_object_time").on(t.accountId, t.objectId, t.requestedAt),
    index("instagram_attempt_operation").on(t.operationId),
  ],
);
export const collectionPolicyHistory = sqliteTable(
  "collection_policy_history",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    effectiveFrom: integer("effective_from").notNull(),
    effectiveTo: integer("effective_to"),
    version: text("version").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    policyJson: text("policy_json").notNull(),
  },
  (t) => [index("collection_policy_account_time").on(t.accountId, t.effectiveFrom)],
);
