-- Rename Paddle-specific payment columns to provider-agnostic names.
-- This lets the same schema work with Oceanpayment (or any future PSP)
-- without another migration.

ALTER TABLE `users` ADD COLUMN `payment_provider` text;
ALTER TABLE `users` ADD COLUMN `payment_subscription_id` text;
ALTER TABLE `users` ADD COLUMN `payment_customer_id` text;

-- Backfill existing Paddle customers so we don't lose subscription linkage.
UPDATE `users`
SET `payment_provider` = 'paddle'
WHERE `paddle_subscription_id` IS NOT NULL
   OR `paddle_customer_id` IS NOT NULL;

UPDATE `users`
SET `payment_subscription_id` = `paddle_subscription_id`,
    `payment_customer_id`     = `paddle_customer_id`;

ALTER TABLE `users` DROP COLUMN `paddle_subscription_id`;
ALTER TABLE `users` DROP COLUMN `paddle_customer_id`;
