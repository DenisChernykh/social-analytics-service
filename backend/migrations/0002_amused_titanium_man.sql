CREATE TABLE `account_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`signature` text NOT NULL,
	`observed_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_insights_query_time` ON `account_insights` (`account_id`,`signature`,`observed_at`);--> statement-breakpoint
CREATE TABLE `business_records` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`cursor` text,
	`pages` integer DEFAULT 0 NOT NULL,
	`collected` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`last_success_at` integer,
	`error_code` text,
	`lease_token` text,
	`lease_expires_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_due` ON `collection_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `collection_schedules` (
	`account_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`discovery_minutes` integer DEFAULT 360 NOT NULL,
	`next_discovery_at` integer NOT NULL,
	`next_stories_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_success_at` integer,
	`error_code` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`signature` text NOT NULL,
	`observed_at` integer NOT NULL,
	`result_json` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`parent_id` text,
	`text` text NOT NULL,
	`published_at` integer NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_media_time` ON `comments` (`media_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`plan_json` text NOT NULL,
	`conclusion_json` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `story_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `media` ADD `context_json` text;--> statement-breakpoint
ALTER TABLE `media_snapshots` ADD `story_insights_json` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `kind` text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `target_media_id` text;