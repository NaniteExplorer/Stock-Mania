-- Nothing is withheld unless the platform says it is.
--
-- `tds_rate_scaled` defaulted to 10%, matching a §194A reading the domain no
-- longer makes. Section 194A withholds on "interest", which §2(28A) defines as
-- payable on moneys borrowed or a debt incurred — and a gram-denominated fee on
-- a bailment of metal is arguably neither. No CBDT circular, ruling or FAQ
-- covers gold-lease income, and the platforms surveyed withhold nothing.
--
-- `DEFAULT_TDS_RATE` in `src/domain/leasing.ts` became zero for that reason. The
-- column default did not, and the two disagreeing is a trap rather than a
-- cosmetic drift: the repository always writes the rate explicitly, so the
-- default is unreachable through the app — but any raw insert that omits the
-- column silently withholds 10% of somebody's gold.
--
-- **No stored rate changes.** Every existing lease keeps the rate in its own
-- row, 10% included; only the value the column falls back to is different. That
-- is the whole point — a lease opened under the old reading was correct under
-- that reading, and rewriting history to match a new default would be inventing
-- a tax position the user never took.
--
-- SQLite cannot alter a column default in place, so the table is rebuilt. Safe
-- to do here: nothing references `gold_leases` (verified against the live
-- schema), so there is no foreign-key fan-in to break. Indexes are recreated
-- afterwards because dropping the table drops them too.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `__new_gold_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reference` text NOT NULL,
	`instrument_id` text NOT NULL,
	`holding_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`quantity_scaled` integer NOT NULL,
	`start_on` text NOT NULL,
	`closes_on` text NOT NULL,
	`annual_rate_scaled` integer NOT NULL,
	`tds_rate_scaled` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`ended_on` text,
	`source_reference` text,
	`credited_quantity_scaled` integer DEFAULT 0 NOT NULL,
	`last_accrual_transaction_id` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`institution_id` text REFERENCES `institutions`(`id`),
	`payout_frequency` text DEFAULT 'MONTHLY' NOT NULL,
	`payout_mode` text DEFAULT 'GRAMS' NOT NULL,
	`payout_account_id` text REFERENCES `ledger_accounts`(`id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`holding_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_accrual_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "gold_leases_quantity_positive" CHECK("__new_gold_leases"."quantity_scaled" > 0),
	CONSTRAINT "gold_leases_term_positive" CHECK("__new_gold_leases"."closes_on" > "__new_gold_leases"."start_on"),
	CONSTRAINT "gold_leases_rate_not_negative" CHECK("__new_gold_leases"."annual_rate_scaled" >= 0),
	CONSTRAINT "gold_leases_tds_rate_in_range" CHECK("__new_gold_leases"."tds_rate_scaled" >= 0 AND "__new_gold_leases"."tds_rate_scaled" <= 100000000),
	CONSTRAINT "gold_leases_credited_not_negative" CHECK("__new_gold_leases"."credited_quantity_scaled" >= 0)
);--> statement-breakpoint

-- Columns are named on both sides rather than `SELECT *`: the four appended by
-- earlier migrations sit after `updated_at` in the live table, and relying on
-- positional order would silently transpose them.
INSERT INTO `__new_gold_leases` (
	`id`, `user_id`, `reference`, `instrument_id`, `holding_account_id`, `platform`,
	`quantity_scaled`, `start_on`, `closes_on`, `annual_rate_scaled`, `tds_rate_scaled`,
	`status`, `ended_on`, `source_reference`, `credited_quantity_scaled`,
	`last_accrual_transaction_id`, `notes`, `deleted_at`, `created_at`, `updated_at`,
	`institution_id`, `payout_frequency`, `payout_mode`, `payout_account_id`
)
SELECT
	`id`, `user_id`, `reference`, `instrument_id`, `holding_account_id`, `platform`,
	`quantity_scaled`, `start_on`, `closes_on`, `annual_rate_scaled`, `tds_rate_scaled`,
	`status`, `ended_on`, `source_reference`, `credited_quantity_scaled`,
	`last_accrual_transaction_id`, `notes`, `deleted_at`, `created_at`, `updated_at`,
	`institution_id`, `payout_frequency`, `payout_mode`, `payout_account_id`
FROM `gold_leases`;--> statement-breakpoint

DROP TABLE `gold_leases`;--> statement-breakpoint
ALTER TABLE `__new_gold_leases` RENAME TO `gold_leases`;--> statement-breakpoint

CREATE UNIQUE INDEX `gold_leases_user_reference_uq` ON `gold_leases` (`user_id`,`reference`);--> statement-breakpoint
CREATE INDEX `gold_leases_user_status_idx` ON `gold_leases` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `gold_leases_instrument_idx` ON `gold_leases` (`instrument_id`,`start_on`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
