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
