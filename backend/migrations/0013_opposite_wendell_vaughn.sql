CREATE INDEX `account_insights_account_time` ON `account_insights` (`account_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `instagram_attempt_time` ON `instagram_http_attempts` (`requested_at`);--> statement-breakpoint
CREATE INDEX `instagram_attempt_account_time` ON `instagram_http_attempts` (`account_id`,`requested_at`,`id`);