CREATE TABLE `comment_media_state` (
	`media_id` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer,
	`last_complete_at` integer,
	`next_refresh_at` integer DEFAULT 0 NOT NULL,
	`last_comments_count` integer,
	`event_generation` integer DEFAULT 0 NOT NULL,
	`processed_generation` integer DEFAULT 0 NOT NULL,
	`last_webhook_at` integer,
	`omitted_branches` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_media_id` text NOT NULL,
	`media_id` text,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_webhook_state` (
	`account_id` text PRIMARY KEY NOT NULL,
	`subscription_confirmed_at` integer,
	`last_received_at` integer,
	`last_event_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `target_media_id` text;