CREATE TABLE `form_mapping_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country` text NOT NULL,
	`form_type` text NOT NULL,
	`tax_year` integer NOT NULL,
	`version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fmv_unique` ON `form_mapping_versions` (`country`,`form_type`,`tax_year`,`version`);--> statement-breakpoint
CREATE INDEX `idx_fmv_lookup` ON `form_mapping_versions` (`country`,`tax_year`,`form_type`,`version`);--> statement-breakpoint
ALTER TABLE `form_field_mappings` ADD `version_id` integer REFERENCES form_mapping_versions(id);