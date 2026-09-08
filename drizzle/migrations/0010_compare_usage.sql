CREATE TABLE `compare_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`gross_income` real NOT NULL,
	`tax_year` integer NOT NULL,
	`income_type` text NOT NULL,
	`filing_status` text NOT NULL
);
