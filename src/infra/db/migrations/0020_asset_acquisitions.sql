CREATE TABLE `asset_acquisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`asset_account_id` text NOT NULL,
	`posting_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `asset_acquisitions_user_live_idx` ON `asset_acquisitions` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_acquisitions_live_asset_unique` ON `asset_acquisitions` (`asset_account_id`) WHERE "asset_acquisitions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_acquisitions_live_posting_unique` ON `asset_acquisitions` (`posting_id`) WHERE "asset_acquisitions"."deleted_at" IS NULL;