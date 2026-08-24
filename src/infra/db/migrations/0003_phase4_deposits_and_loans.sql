CREATE TABLE `deposit_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`amount_minor` integer DEFAULT 0 NOT NULL,
	`employee_minor` integer DEFAULT 0 NOT NULL,
	`employer_minor` integer DEFAULT 0 NOT NULL,
	`voluntary_minor` integer DEFAULT 0 NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_contributions_account_fy_uq` ON `deposit_contributions` (`account_id`,`financial_year`);--> statement-breakpoint
CREATE INDEX `deposit_contributions_user_idx` ON `deposit_contributions` (`user_id`);--> statement-breakpoint
CREATE TABLE `deposit_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`principal_minor` integer,
	`instalment_minor` integer,
	`months` integer,
	`interest_rate_scaled` integer,
	`day_count_convention` text DEFAULT 'ACT_365F' NOT NULL,
	`accrual_basis` text DEFAULT 'COMPOUND' NOT NULL,
	`compounding` text DEFAULT 'QUARTERLY' NOT NULL,
	`payout` text DEFAULT 'CUMULATIVE' NOT NULL,
	`opened_on` text NOT NULL,
	`matures_on` text,
	`premature_penalty_percent_scaled` integer,
	`nps_tier` text,
	`extension_blocks` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_terms_account_uq` ON `deposit_terms` (`account_id`);--> statement-breakpoint
CREATE INDEX `deposit_terms_user_kind_idx` ON `deposit_terms` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `loan_prepayments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`paid_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`reduces` text DEFAULT 'TERM' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `loan_prepayments_account_idx` ON `loan_prepayments` (`account_id`,`paid_on`);--> statement-breakpoint
CREATE TABLE `loan_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`principal_minor` integer NOT NULL,
	`interest_rate_scaled` integer NOT NULL,
	`day_count_convention` text DEFAULT 'ACT_365F' NOT NULL,
	`accrual_basis` text DEFAULT 'REDUCING_BALANCE' NOT NULL,
	`periods` integer NOT NULL,
	`payment_frequency` text DEFAULT 'MONTHLY' NOT NULL,
	`disbursed_on` text NOT NULL,
	`first_payment_on` text,
	`prepayment_penalty_percent_scaled` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "loan_terms_periods_positive" CHECK("loan_terms"."periods" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loan_terms_account_uq` ON `loan_terms` (`account_id`);--> statement-breakpoint
CREATE INDEX `loan_terms_user_kind_idx` ON `loan_terms` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `nps_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`scheme` text NOT NULL,
	`units_scaled` integer DEFAULT 0 NOT NULL,
	`scheme_code` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nps_holdings_account_scheme_uq` ON `nps_holdings` (`account_id`,`scheme`);--> statement-breakpoint
CREATE INDEX `nps_holdings_user_idx` ON `nps_holdings` (`user_id`);--> statement-breakpoint
CREATE TABLE `scheme_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scheme_key` text NOT NULL,
	`financial_year` text NOT NULL,
	`rate_scaled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheme_rates_user_scheme_fy_uq` ON `scheme_rates` (`user_id`,`scheme_key`,`financial_year`);