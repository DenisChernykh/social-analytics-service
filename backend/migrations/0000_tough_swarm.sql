CREATE TABLE `account_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`followers_count` integer,
	`media_count` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_snapshots_time` ON `account_snapshots` (`account_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`username` text NOT NULL,
	`account_type` text NOT NULL,
	`connected_at` integer NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_platform_external` ON `accounts` (`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `instagram_connections` (
	`account_id` text PRIMARY KEY NOT NULL,
	`encrypted_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`refreshed_at` integer NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`caption` text NOT NULL,
	`title` text,
	`search_text` text NOT NULL,
	`media_type` text NOT NULL,
	`product_type` text NOT NULL,
	`permalink` text NOT NULL,
	`published_at` integer NOT NULL,
	`duration_seconds` real,
	`duration_source` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_account_external` ON `media` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `media_account_published` ON `media` (`account_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `media_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`api_version` text NOT NULL,
	`metrics_json` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_media_time` ON `media_snapshots` (`media_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `oauth_attempts` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_leases` (
	`account_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`input_cursor` text,
	`page_size` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`lease_expires_at` integer NOT NULL,
	`next_cursor` text,
	`media_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_account_status` ON `sync_runs` (`account_id`,`status`);