DROP INDEX IF EXISTS `transactions_fingerprint_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fingerprint_uq` ON `transactions` (`user_id`,`fingerprint`) WHERE "transactions"."fingerprint" IS NOT NULL AND "transactions"."deleted_at" IS NULL;
