ALTER TABLE `sync_runs` ADD `useful_values` integer;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `coverage_state` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `first_useful_at` integer;