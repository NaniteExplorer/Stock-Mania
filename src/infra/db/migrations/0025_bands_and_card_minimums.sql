CREATE TABLE `card_minimum_dues` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`statement_through` text NOT NULL,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`amount_minor` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_minimum_dues_fields_check" CHECK(typeof(amount_minor) = 'integer' AND amount_minor >= 0 AND length(statement_through) = 10 AND length(currency) = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_minimum_dues_account_statement_unique` ON `card_minimum_dues` (`account_id`,`statement_through`);--> statement-breakpoint
CREATE INDEX `card_minimum_dues_user_idx` ON `card_minimum_dues` (`user_id`);--> statement-breakpoint
CREATE TABLE `rebalancing_bands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`absolute_scaled` integer NOT NULL,
	`relative_scaled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rebalancing_bands_fields_check" CHECK(typeof(absolute_scaled) = 'integer' AND typeof(relative_scaled) = 'integer' AND absolute_scaled > 5000000 AND absolute_scaled <= 100000000 AND relative_scaled > 25000000 AND relative_scaled <= 100000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rebalancing_bands_user_unique` ON `rebalancing_bands` (`user_id`);