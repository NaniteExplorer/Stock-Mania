CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`request_id` text NOT NULL,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_at_idx` ON `audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_request_idx` ON `audit_events` (`request_id`);--> statement-breakpoint
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
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`month` text,
	`limit_minor` integer NOT NULL,
	`warn_at_percent` integer DEFAULT 80 NOT NULL,
	`deleted_at` integer,
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
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_user_pattern_uq` ON `category_rules` (`user_id`,`pattern`,`applies_to`);--> statement-breakpoint
CREATE INDEX `category_rules_user_priority_idx` ON `category_rules` (`user_id`,`priority`);--> statement-breakpoint
CREATE TABLE `charge_rates` (
	`broker_id` text NOT NULL,
	`segment` text NOT NULL,
	`charge_type` text NOT NULL,
	`side` text NOT NULL,
	`basis` text NOT NULL,
	`rate_scaled` integer,
	`flat_minor` integer,
	`cap_minor` integer,
	`min_minor` integer,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`deductibility` text NOT NULL,
	`rounding` text DEFAULT 'HALF_UP' NOT NULL,
	`rounding_unit` text DEFAULT 'PAISE' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charge_rates_pk` ON `charge_rates` (`broker_id`,`segment`,`charge_type`,`side`,`effective_from`);--> statement-breakpoint
CREATE TABLE `corporate_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`action_type` text NOT NULL,
	`ex_date` text NOT NULL,
	`record_date` text,
	`pay_date` text,
	`ratio_from_scaled` integer,
	`ratio_to_scaled` integer,
	`cash_amount_minor` integer,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`target_instrument_id` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`applied_transaction_id` text,
	`applied_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corporate_actions_uq` ON `corporate_actions` (`instrument_id`,`action_type`,`ex_date`);--> statement-breakpoint
CREATE INDEX `corporate_actions_instrument_idx` ON `corporate_actions` (`instrument_id`,`ex_date`);--> statement-breakpoint
CREATE TABLE `cost_inflation_index` (
	`financial_year` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counterparties` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalised_name` text NOT NULL,
	`is_self` integer DEFAULT false NOT NULL,
	`default_category_id` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `counterparties_user_norm_uq` ON `counterparties` (`user_id`,`normalised_name`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sha256` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`storage_key` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_user_sha_uq` ON `documents` (`user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`base` text(3) NOT NULL,
	`quote` text(3) NOT NULL,
	`as_of` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_rate_scaled` integer,
	`user_rate_scaled` integer,
	`source_type` text NOT NULL,
	`derivation` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`superseded_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_pair_uq` ON `fx_rates` (`base`,`quote`,`as_of`,`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `fx_rates_lookup_idx` ON `fx_rates` (`base`,`quote`,`as_of`);--> statement-breakpoint
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
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_batches_user_idx` ON `import_batches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`raw_json` text NOT NULL,
	`parsed_json` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`matched_transaction_id` text,
	`match_pass` integer,
	`rejected_reason` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_batch_row_uq` ON `import_rows` (`batch_id`,`row_index`);--> statement-breakpoint
CREATE INDEX `import_rows_status_idx` ON `import_rows` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `institutions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider_id` text,
	`kind` text NOT NULL,
	`country` text(2) DEFAULT 'IN' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `institutions_user_name_uq` ON `institutions` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `instrument_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`kind` text NOT NULL,
	`received_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`tax_deducted_minor` integer DEFAULT 0 NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`transaction_id` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict
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
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_user_symbol_uq` ON `instruments` (`user_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `instruments_user_kind_idx` ON `instruments` (`user_id`,`kind`);--> statement-breakpoint
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
	`revision` integer DEFAULT 0 NOT NULL,
	`min_affected_date` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_user_code_uq` ON `ledger_accounts` (`user_id`,`code`);--> statement-breakpoint
CREATE INDEX `ledger_accounts_user_type_idx` ON `ledger_accounts` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `ledger_accounts_parent_idx` ON `ledger_accounts` (`parent_id`);--> statement-breakpoint
CREATE TABLE `ledger_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`effective_on` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_events_user_seq_idx` ON `ledger_events` (`user_id`,`seq`);--> statement-breakpoint
CREATE INDEX `ledger_events_aggregate_idx` ON `ledger_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE INDEX `ledger_events_effective_idx` ON `ledger_events` (`user_id`,`effective_on`);--> statement-breakpoint
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
	`deleted_at` integer,
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
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buy_trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lots_remaining_within_original" CHECK("lots"."remaining_quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `lots_open_fifo_idx` ON `lots` (`instrument_id`,`acquired_on`,`remaining_quantity`);--> statement-breakpoint
CREATE INDEX `lots_user_idx` ON `lots` (`user_id`);--> statement-breakpoint
CREATE TABLE `market_holidays` (
	`mic` text NOT NULL,
	`holiday_date` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_holidays_pk` ON `market_holidays` (`mic`,`holiday_date`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `net_worth_snapshots_user_month_uq` ON `net_worth_snapshots` (`user_id`,`month`);--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`memo` text,
	`instrument_id` text,
	`quantity_scaled` integer,
	`unit_cost_minor` integer,
	`category_id` text,
	`status` text DEFAULT 'CLEARED' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "postings_amount_not_negative" CHECK("postings"."amount_minor" >= 0),
	CONSTRAINT "postings_moves_something" CHECK("postings"."amount_minor" <> 0 OR ("postings"."quantity_scaled" IS NOT NULL AND "postings"."quantity_scaled" <> 0)),
	CONSTRAINT "postings_commodity_coherent" CHECK(("postings"."instrument_id" IS NULL AND "postings"."quantity_scaled" IS NULL AND "postings"."unit_cost_minor" IS NULL)
          OR ("postings"."instrument_id" IS NOT NULL AND "postings"."quantity_scaled" IS NOT NULL)),
	CONSTRAINT "postings_no_category_on_commodity" CHECK(NOT ("postings"."category_id" IS NOT NULL AND "postings"."instrument_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `postings_account_idx` ON `postings` (`account_id`);--> statement-breakpoint
CREATE INDEX `postings_transaction_idx` ON `postings` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `postings_instrument_idx` ON `postings` (`instrument_id`);--> statement-breakpoint
CREATE TABLE `price_divergences` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`as_of` text NOT NULL,
	`quote_type` text NOT NULL,
	`provider_a` text NOT NULL,
	`provider_b` text NOT NULL,
	`price_a_minor` integer NOT NULL,
	`price_b_minor` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`delta_percent_scaled` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_divergences_instrument_idx` ON `price_divergences` (`instrument_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `price_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`as_of` text NOT NULL,
	`quote_type` text DEFAULT 'CLOSE' NOT NULL,
	`price_scaled` integer NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`provider_id` text DEFAULT 'manual' NOT NULL,
	`source_type` text DEFAULT 'MANUAL' NOT NULL,
	`ingested_at` integer NOT NULL,
	`superseded_by` text,
	`raw_payload_hash` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_quotes_price_positive" CHECK("price_quotes"."price_scaled" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_quotes_bitemporal_uq` ON `price_quotes` (`instrument_id`,`as_of`,`quote_type`,`provider_id`,`ingested_at`);--> statement-breakpoint
CREATE INDEX `price_quotes_ladder_idx` ON `price_quotes` (`instrument_id`,`quote_type`,`as_of`);--> statement-breakpoint
CREATE INDEX `price_quotes_current_idx` ON `price_quotes` (`instrument_id`,`as_of`,`superseded_by`);--> statement-breakpoint
CREATE TABLE `projection_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`projection` text NOT NULL,
	`scope` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`as_of` text,
	`revision_vector_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_cache_key_uq` ON `projection_cache` (`user_id`,`projection`,`scope`,`period_start`,`period_end`,`as_of`);--> statement-breakpoint
CREATE INDEX `projection_cache_user_idx` ON `projection_cache` (`user_id`,`projection`);--> statement-breakpoint
CREATE TABLE `provider_fetch_log` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`instrument_id` text,
	`quote_type` text,
	`covered_from` text,
	`covered_through` text,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_fetch_log_uq` ON `provider_fetch_log` (`provider_id`,`instrument_id`,`quote_type`);--> statement-breakpoint
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
CREATE TABLE `tax_rules` (
	`jurisdiction` text DEFAULT 'IN' NOT NULL,
	`regime` text NOT NULL,
	`tax_category` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`long_term_days` integer,
	`ltcg_rate_scaled` integer,
	`stcg_rate_scaled` integer,
	`indexation_allowed` integer DEFAULT false NOT NULL,
	`grandfather_date` text,
	`exemption_limit_minor` integer,
	`currency` text(3) DEFAULT 'INR' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rules_pk` ON `tax_rules` (`jurisdiction`,`regime`,`tax_category`,`effective_from`);--> statement-breakpoint
CREATE TABLE `tax_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`regime_key` text DEFAULT 'india-fy2025' NOT NULL,
	`marginal_slab_percent` integer NOT NULL,
	`ltcg_exemption_minor` integer NOT NULL,
	`uses_new_regime` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_settings_user_fy_uq` ON `tax_settings` (`user_id`,`financial_year`);--> statement-breakpoint
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
	`transaction_id` text,
	`settlement_account_id` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`settlement_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_quantity_positive" CHECK("trades"."quantity" > 0),
	CONSTRAINT "trades_price_non_negative" CHECK("trades"."price_per_unit_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `trades_user_instrument_idx` ON `trades` (`user_id`,`instrument_id`,`traded_on`);--> statement-breakpoint
CREATE INDEX `trades_user_date_idx` ON `trades` (`user_id`,`traded_on`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`txn_type` text NOT NULL,
	`txn_date` text NOT NULL,
	`settlement_date` text,
	`description` text NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`reference` text,
	`external_id` text,
	`counterparty_id` text,
	`import_batch_id` text,
	`reverses_transaction_id` text,
	`is_forecast` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`fingerprint` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reverses_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `transactions_user_date_idx` ON `transactions` (`user_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `transactions_batch_idx` ON `transactions` (`import_batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fingerprint_uq` ON `transactions` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_external_id_uq` ON `transactions` (`user_id`,`external_id`) WHERE "transactions"."external_id" IS NOT NULL AND "transactions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `txn_type_legality` (
	`txn_type` text NOT NULL,
	`source_role` text NOT NULL,
	`destination_role` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_type_legality_pk` ON `txn_type_legality` (`txn_type`,`source_role`,`destination_role`);--> statement-breakpoint
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
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);