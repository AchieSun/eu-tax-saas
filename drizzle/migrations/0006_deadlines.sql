CREATE TABLE `deadlines` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `tax_year` integer NOT NULL,
  `jurisdiction` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `due_date` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `category` text NOT NULL,
  `source` text DEFAULT 'user' NOT NULL,
  `reminder_days` integer DEFAULT 7 NOT NULL,
  `snoozed_until` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);

CREATE INDEX `idx_deadlines_user_status` ON `deadlines` (`user_id`, `status`);
CREATE INDEX `idx_deadlines_user_due_date` ON `deadlines` (`user_id`, `due_date`);
CREATE INDEX `idx_deadlines_user_year` ON `deadlines` (`user_id`, `tax_year`);
