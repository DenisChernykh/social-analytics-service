ALTER TABLE `collection_jobs` ADD `automatic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `media_processed` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `collection_jobs` SET `automatic`=1 WHERE `origin` IN ('scheduled','stories');
