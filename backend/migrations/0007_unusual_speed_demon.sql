CREATE INDEX `collection_comment_target` ON `collection_jobs` (`target_media_id`,`status`);--> statement-breakpoint
CREATE INDEX `collection_account_origin` ON `collection_jobs` (`account_id`,`origin`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `comment_collections_media_time` ON `comment_collections` (`media_id`,`observed_at`);