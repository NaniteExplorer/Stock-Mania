CREATE TABLE `gold_leases` (
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
	`tds_rate_scaled` integer DEFAULT 10000000 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`ended_on` text,
	`source_reference` text,
	`credited_quantity_scaled` integer DEFAULT 0 NOT NULL,
	`last_accrual_transaction_id` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`holding_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_accrual_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "gold_leases_quantity_positive" CHECK("gold_leases"."quantity_scaled" > 0),
	CONSTRAINT "gold_leases_term_positive" CHECK("gold_leases"."closes_on" > "gold_leases"."start_on"),
	CONSTRAINT "gold_leases_rate_not_negative" CHECK("gold_leases"."annual_rate_scaled" >= 0),
	CONSTRAINT "gold_leases_tds_rate_in_range" CHECK("gold_leases"."tds_rate_scaled" >= 0 AND "gold_leases"."tds_rate_scaled" <= 100000000),
	CONSTRAINT "gold_leases_credited_not_negative" CHECK("gold_leases"."credited_quantity_scaled" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gold_leases_user_reference_uq` ON `gold_leases` (`user_id`,`reference`);--> statement-breakpoint
CREATE INDEX `gold_leases_user_status_idx` ON `gold_leases` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `gold_leases_instrument_idx` ON `gold_leases` (`instrument_id`,`start_on`);