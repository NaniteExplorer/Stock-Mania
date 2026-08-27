DROP INDEX IF EXISTS `ledger_accounts_user_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_user_code_uq` ON `ledger_accounts` (`user_id`,`code`) WHERE "ledger_accounts"."deleted_at" IS NULL;
