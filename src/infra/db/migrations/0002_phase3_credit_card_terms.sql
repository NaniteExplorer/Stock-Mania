CREATE TABLE `credit_card_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`credit_limit_minor` integer DEFAULT 0 NOT NULL,
	`statement_day` integer DEFAULT 18 NOT NULL,
	`grace_days` integer DEFAULT 20 NOT NULL,
	`finance_rate_scaled` integer DEFAULT 0 NOT NULL,
	`finance_convention` text DEFAULT 'ACT_365F' NOT NULL,
	`minimum_due_percent_scaled` integer DEFAULT 0 NOT NULL,
	`minimum_due_floor_minor` integer DEFAULT 0 NOT NULL,
	`late_fee_minor` integer DEFAULT 0 NOT NULL,
	`annual_fee_minor` integer DEFAULT 0 NOT NULL,
	`gst_on_charges_percent_scaled` integer DEFAULT 0 NOT NULL,
	`points_per_hundred_scaled` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_card_terms_statement_day" CHECK("credit_card_terms"."statement_day" BETWEEN 1 AND 31),
	CONSTRAINT "credit_card_terms_grace_days" CHECK("credit_card_terms"."grace_days" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_card_terms_account_uq` ON `credit_card_terms` (`account_id`);--> statement-breakpoint
CREATE INDEX `credit_card_terms_user_idx` ON `credit_card_terms` (`user_id`);