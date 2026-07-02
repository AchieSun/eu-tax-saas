CREATE TABLE `user_onboarding` (
  `user_id` text PRIMARY KEY NOT NULL,
  `current_step` integer DEFAULT 0 NOT NULL,
  `privacy_accepted_at` integer,
  `completed_at` integer,
  `draft` text DEFAULT '{}' NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
