CREATE TABLE `instagram_api_state` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`api_version` text NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`usage_percent` real,
	`usage_observed_at` integer,
	`recorded_requests` integer DEFAULT 0 NOT NULL,
	`since_at` integer NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instagram_metric_support` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`api_version` text NOT NULL,
	`object_id` text NOT NULL,
	`signature` text NOT NULL,
	`metric` text NOT NULL,
	`observed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instagram_metric_support_scope` ON `instagram_metric_support` (`account_id`,`api_version`,`object_id`,`signature`);--> statement-breakpoint
CREATE INDEX `instagram_metric_support_expiry` ON `instagram_metric_support` (`expires_at`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_collection_schedules` (
	`account_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`discovery_minutes` integer DEFAULT 60 NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`next_catalogue_at` integer DEFAULT 0 NOT NULL,
	`next_discovery_at` integer NOT NULL,
	`next_stories_at` integer NOT NULL,
	`next_insights_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`last_success_at` integer,
	`error_code` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_collection_schedules`("account_id", "enabled", "discovery_minutes", "time_zone", "next_catalogue_at", "next_discovery_at", "next_stories_at", "next_insights_at", "updated_at", "last_success_at", "error_code", "failures", "retry_at") SELECT "account_id", "enabled", "discovery_minutes", 'UTC', "updated_at"+2592000000, "next_discovery_at", "next_stories_at", "next_insights_at", "updated_at", "last_success_at", "error_code", "failures", "retry_at" FROM `collection_schedules`;--> statement-breakpoint
DROP TABLE `collection_schedules`;--> statement-breakpoint
ALTER TABLE `__new_collection_schedules` RENAME TO `collection_schedules`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `skipped_media` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `skipped_periods` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_collections` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `comment_collections` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `comment_collections` ADD `page_fingerprint` text;--> statement-breakpoint
CREATE INDEX `comment_collections_job_page` ON `comment_collections` (`job_id`,`parent_id`,`page_fingerprint`);--> statement-breakpoint
ALTER TABLE `comment_media_state` ADD `unavailable_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_id` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author_username` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `like_count` integer;--> statement-breakpoint
ALTER TABLE `comments` ADD `hidden` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `metadata_json` text;--> statement-breakpoint
ALTER TABLE `media` ADD `first_discovered_at` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `discovery_source` text;--> statement-breakpoint
ALTER TABLE `media` ADD `unavailable_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `unavailable_code` text;--> statement-breakpoint
ALTER TABLE `media_snapshots` ADD `profile_activity_json` text;--> statement-breakpoint
ALTER TABLE `media_snapshots` ADD `operation_id` text;--> statement-breakpoint
CREATE INDEX `snapshots_operation` ON `media_snapshots` (`operation_id`);--> statement-breakpoint
UPDATE `media` SET `first_discovered_at`=COALESCE((SELECT MIN(s.observed_at) FROM media_snapshots s WHERE s.media_id=media.id),updated_at),`discovery_source`='history_inferred';--> statement-breakpoint
UPDATE `media_snapshots` SET `operation_id`=substr(id,1,36) WHERE substr(id,37,1)=':' AND length(substr(id,1,36))=36;--> statement-breakpoint
UPDATE `comment_collections` SET `job_id`=json_extract(result_json,'$.jobId'),`parent_id`=json_extract(result_json,'$.parentId'),`page_fingerprint`=json_extract(result_json,'$.pageFingerprint');
