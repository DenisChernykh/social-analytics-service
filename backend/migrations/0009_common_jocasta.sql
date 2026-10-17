CREATE TABLE `collection_policy_history` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`version` text NOT NULL,
	`enabled` integer NOT NULL,
	`policy_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_policy_account_time` ON `collection_policy_history` (`account_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `instagram_http_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`operation_id` text,
	`object_id` text,
	`requested_at` integer NOT NULL,
	`received_at` integer,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instagram_attempt_object_time` ON `instagram_http_attempts` (`account_id`,`object_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `instagram_attempt_operation` ON `instagram_http_attempts` (`operation_id`);--> statement-breakpoint
ALTER TABLE `account_snapshots` ADD `provenance_json` text;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `first_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `last_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `first_useful_observation_at` integer;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `last_useful_observation_at` integer;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `http_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `last_step_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `collection_schedules` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `collection_schedules` ADD `claim_expires_at` integer;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `responses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `failures_before_response` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `timeouts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `rate_limited_responses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `accounting_since_at` integer;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `usage_headers_json` text;--> statement-breakpoint
ALTER TABLE `media_snapshots` ADD `provenance_json` text;