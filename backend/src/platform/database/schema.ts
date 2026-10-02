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
  },
  (table) => [index("snapshots_media_time").on(table.mediaId, table.observedAt)],
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
    automatic: integer("automatic", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull(),
    cursor: text("cursor"),
    pages: integer("pages").notNull().default(0),
    collected: integer("collected").notNull().default(0),
    mediaProcessed: integer("media_processed").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    lastSuccessAt: integer("last_success_at"),
    errorCode: text("error_code"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
  },
  (table) => [index("collection_due").on(table.status, table.nextAttemptAt)],
);

export const collectionSchedules = sqliteTable("collection_schedules", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  discoveryMinutes: integer("discovery_minutes").notNull().default(360),
  nextDiscoveryAt: integer("next_discovery_at").notNull(),
  nextStoriesAt: integer("next_stories_at").notNull(),
  nextInsightsAt: integer("next_insights_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
  lastSuccessAt: integer("last_success_at"),
  errorCode: text("error_code"),
  failures: integer("failures").notNull().default(0),
  retryAt: integer("retry_at").notNull().default(0),
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
  },
  (table) => [index("comments_media_time").on(table.mediaId, table.publishedAt)],
);

export const commentCollections = sqliteTable("comment_collections", {
  id: text("id").primaryKey(),
  mediaId: text("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  signature: text("signature").notNull(),
  observedAt: integer("observed_at").notNull(),
  resultJson: text("result_json").notNull(),
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
