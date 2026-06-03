CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `form_field_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`form_type` text NOT NULL,
	`tax_year` integer NOT NULL,
	`field_name` text NOT NULL,
	`field_label` text,
	`data_path` text NOT NULL,
	`field_type` text DEFAULT 'text' NOT NULL,
	`page_number` integer,
	`box_number` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_form_field_unique` ON `form_field_mappings` (`country`,`form_type`,`tax_year`,`field_name`);--> statement-breakpoint
CREATE TABLE `residency_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`country` text NOT NULL,
	`tax_year` integer NOT NULL,
	`is_resident` integer NOT NULL,
	`confidence` text NOT NULL,
	`reasoning` text NOT NULL,
	`has_conflict` integer DEFAULT false NOT NULL,
	`conflict_with` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_residency_user_year` ON `residency_assessments` (`user_id`,`tax_year`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `strategy_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tax_year` integer NOT NULL,
	`strategy_id` text NOT NULL,
	`tier` text NOT NULL,
	`eligible` integer NOT NULL,
	`estimated_savings` real,
	`confidence` real,
	`action_steps` text,
	`citations` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_user_year` ON `strategy_recommendations` (`user_id`,`tax_year`);--> statement-breakpoint
CREATE TABLE `tax_calculations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`country` text NOT NULL,
	`tax_year` integer NOT NULL,
	`income_type` text NOT NULL,
	`special_status` text,
	`gross_income` real NOT NULL,
	`tax_owed` real NOT NULL,
	`effective_rate` real NOT NULL,
	`breakdown` text NOT NULL,
	`calculated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tax_calc_user` ON `tax_calculations` (`user_id`,`tax_year`);--> statement-breakpoint
CREATE TABLE `tax_filings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`country` text NOT NULL,
	`tax_year` integer NOT NULL,
	`form_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`pdf_r2_key` text,
	`form_data` text NOT NULL,
	`generated_at` integer,
	`submitted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_filings_user` ON `tax_filings` (`user_id`,`tax_year`);--> statement-breakpoint
CREATE TABLE `user_days` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`country` text NOT NULL,
	`date` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_days_unique` ON `user_days` (`user_id`,`country`,`date`);--> statement-breakpoint
CREATE INDEX `idx_user_days_user_date` ON `user_days` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `user_income` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tax_year` integer NOT NULL,
	`income_type` text NOT NULL,
	`country` text NOT NULL,
	`amount_annual` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`withholding_tax` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_income_user_year` ON `user_income` (`user_id`,`tax_year`);--> statement-breakpoint
CREATE TABLE `user_residency` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nationality` text NOT NULL,
	`countries` text NOT NULL,
	`primary_country` text,
	`special_status` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`subscription_status` text DEFAULT 'free' NOT NULL,
	`paddle_subscription_id` text,
	`paddle_customer_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
