CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_account_user_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`narration` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`reference` text,
	`import_batch_id` text,
	`reverses_entry_id` text,
	`fingerprint` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reverses_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `journal_entries_user_date_idx` ON `journal_entries` (`user_id`,`posted_on`);--> statement-breakpoint
CREATE INDEX `journal_entries_batch_idx` ON `journal_entries` (`import_batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_fingerprint_uq` ON `journal_entries` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`parent_id` text,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`institution` text,
	`account_number_suffix` text(4),
	`is_closed` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_user_code_uq` ON `ledger_accounts` (`user_id`,`code`);--> statement-breakpoint
CREATE INDEX `ledger_accounts_user_type_idx` ON `ledger_accounts` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `ledger_accounts_parent_idx` ON `ledger_accounts` (`parent_id`);--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`memo` text,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "postings_amount_positive" CHECK("postings"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `postings_account_idx` ON `postings` (`account_id`);--> statement-breakpoint
CREATE INDEX `postings_entry_idx` ON `postings` (`entry_id`);--> statement-breakpoint
CREATE TABLE `instrument_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`kind` text NOT NULL,
	`received_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`tax_deducted_minor` integer DEFAULT 0 NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`journal_entry_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `instrument_incomes_idx` ON `instrument_incomes` (`instrument_id`,`received_on`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`tax_asset_class` text NOT NULL,
	`isin` text(12),
	`exchange` text,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`quote_source` text DEFAULT 'MANUAL' NOT NULL,
	`quote_source_ref` text,
	`asset_account_id` text NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_user_symbol_uq` ON `instruments` (`user_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `instruments_user_kind_idx` ON `instruments` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `lot_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sell_trade_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`proceeds_minor` integer NOT NULL,
	`cost_basis_minor` integer NOT NULL,
	`buy_charges_minor` integer DEFAULT 0 NOT NULL,
	`sell_charges_minor` integer DEFAULT 0 NOT NULL,
	`realized_gain_minor` integer NOT NULL,
	`holding_days` integer NOT NULL,
	`tax_tier` text NOT NULL,
	`estimated_tax_minor` integer DEFAULT 0 NOT NULL,
	`financial_year` text NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sell_trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lot_matches_user_fy_idx` ON `lot_matches` (`user_id`,`financial_year`);--> statement-breakpoint
CREATE INDEX `lot_matches_sell_idx` ON `lot_matches` (`sell_trade_id`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`buy_trade_id` text NOT NULL,
	`acquired_on` text NOT NULL,
	`original_quantity` integer NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`cost_per_unit_minor` integer NOT NULL,
	`buy_charges_minor` integer DEFAULT 0 NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buy_trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lots_remaining_within_original" CHECK("lots"."remaining_quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `lots_open_fifo_idx` ON `lots` (`instrument_id`,`acquired_on`,`remaining_quantity`);--> statement-breakpoint
CREATE INDEX `lots_user_idx` ON `lots` (`user_id`);--> statement-breakpoint
CREATE TABLE `price_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`as_of` text NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_quotes_instrument_date_source_uq` ON `price_quotes` (`instrument_id`,`as_of`,`source`);--> statement-breakpoint
CREATE INDEX `price_quotes_latest_idx` ON `price_quotes` (`instrument_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`traded_on` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_per_unit_minor` integer NOT NULL,
	`brokerage_minor` integer DEFAULT 0 NOT NULL,
	`stt_minor` integer DEFAULT 0 NOT NULL,
	`exchange_txn_charge_minor` integer DEFAULT 0 NOT NULL,
	`sebi_turnover_fee_minor` integer DEFAULT 0 NOT NULL,
	`stamp_duty_minor` integer DEFAULT 0 NOT NULL,
	`gst_minor` integer DEFAULT 0 NOT NULL,
	`dp_charges_minor` integer DEFAULT 0 NOT NULL,
	`other_charges_minor` integer DEFAULT 0 NOT NULL,
	`journal_entry_id` text,
	`settlement_account_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`settlement_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_quantity_positive" CHECK("trades"."quantity" > 0),
	CONSTRAINT "trades_price_non_negative" CHECK("trades"."price_per_unit_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `trades_user_instrument_idx` ON `trades` (`user_id`,`instrument_id`,`traded_on`);--> statement-breakpoint
CREATE INDEX `trades_user_date_idx` ON `trades` (`user_id`,`traded_on`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`month` text,
	`limit_minor` integer NOT NULL,
	`warn_at_percent` integer DEFAULT 80 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_user_account_month_uq` ON `budgets` (`user_id`,`account_id`,`month`);--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'CONTAINS' NOT NULL,
	`account_id` text NOT NULL,
	`applies_to` text DEFAULT 'ANY' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_user_pattern_uq` ON `category_rules` (`user_id`,`pattern`,`applies_to`);--> statement-breakpoint
CREATE INDEX `category_rules_user_priority_idx` ON `category_rules` (`user_id`,`priority`);--> statement-breakpoint
CREATE TABLE `tax_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`regime_key` text DEFAULT 'india-fy2025' NOT NULL,
	`marginal_slab_percent` integer NOT NULL,
	`ltcg_exemption_minor` integer NOT NULL,
	`uses_new_regime` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_settings_user_fy_uq` ON `tax_settings` (`user_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`rows_read` integer DEFAULT 0 NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`rows_duplicate` integer DEFAULT 0 NOT NULL,
	`rows_failed` integer DEFAULT 0 NOT NULL,
	`problems_json` text,
	`status` text NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_batches_user_idx` ON `import_batches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `net_worth_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`assets_minor` integer NOT NULL,
	`liabilities_minor` integer NOT NULL,
	`net_worth_minor` integer NOT NULL,
	`investments_minor` integer DEFAULT 0 NOT NULL,
	`income_minor` integer DEFAULT 0 NOT NULL,
	`expense_minor` integer DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `net_worth_snapshots_user_month_uq` ON `net_worth_snapshots` (`user_id`,`month`);