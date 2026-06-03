CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`user_id_or_null` text,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`input_hash` text,
	`result_hash` text,
	`status_code` integer NOT NULL,
	`source` text DEFAULT 'api' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_user_time` ON `audit_log` (`user_id_or_null`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_route_time` ON `audit_log` (`route`,`timestamp`);--> statement-breakpoint
DROP INDEX `idx_user_days_unique`;--> statement-breakpoint
ALTER TABLE `user_days` ADD `note` text;--> statement-breakpoint
-- W3: dedupe user_days before adopting (user_id, date) unique index.
-- Safe because no production data exists yet (pre-launch repo).
DELETE FROM user_days WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM user_days GROUP BY user_id, date
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_days_unique` ON `user_days` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `pdf_r2_key` text;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `pdf_sha256` text;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `page_count` integer;--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;