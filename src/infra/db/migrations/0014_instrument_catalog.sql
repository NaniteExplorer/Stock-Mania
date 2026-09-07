-- Persistent private catalogue cache. Bulk provider snapshots are parsed and
-- reduced to these normalized rows; raw dumps and credentials never enter the DB.
CREATE TABLE `instrument_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text,
	`name` text NOT NULL,
	`instrument_type` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `instrument_catalog_isin_format` CHECK (`isin` IS NULL OR (length(`isin`) = 12 AND `isin` = upper(`isin`)))
);--> statement-breakpoint
CREATE UNIQUE INDEX `instrument_catalog_isin_uq` ON `instrument_catalog` (`isin`);--> statement-breakpoint

CREATE TABLE `instrument_catalog_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_instrument_id` text NOT NULL,
	`exchange` text NOT NULL,
	`segment` text NOT NULL,
	`symbol` text NOT NULL,
	`normalized_symbol` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`instrument_type` text NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`checksum` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`catalog_instrument_id`) REFERENCES `instrument_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `instrument_catalog_listing_uq` ON `instrument_catalog_listings` (`exchange`,`segment`,`normalized_symbol`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_listing_search_idx` ON `instrument_catalog_listings` (`normalized_symbol`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_listing_instrument_idx` ON `instrument_catalog_listings` (`catalog_instrument_id`);--> statement-breakpoint

CREATE TABLE `instrument_provider_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_instrument_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_instrument_id` text NOT NULL,
	`provider_token` text,
	`trading_symbol` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_through` text,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`checksum` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`catalog_instrument_id`) REFERENCES `instrument_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `instrument_catalog_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `instrument_provider_mapping_range` CHECK (`effective_through` IS NULL OR `effective_through` > `effective_from`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `instrument_provider_mapping_version_uq` ON `instrument_provider_mappings` (`provider`,`provider_instrument_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `instrument_provider_mapping_active_idx` ON `instrument_provider_mappings` (`listing_id`,`provider`,`effective_through`);--> statement-breakpoint

-- `checksum = ''` marks a failed attempt. This keeps the 24-hour retry gate
-- durable without persisting an upstream error body or a credential-bearing URL.
CREATE TABLE `instrument_catalog_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`checksum` text NOT NULL,
	`row_count` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `instrument_catalog_fetch_rows_nonnegative` CHECK (`row_count` >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `instrument_catalog_fetch_uq` ON `instrument_catalog_fetches` (`source`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_fetch_latest_idx` ON `instrument_catalog_fetches` (`source`,`fetched_at`);--> statement-breakpoint

CREATE TABLE `instrument_catalog_links` (
	`portfolio_instrument_id` text PRIMARY KEY NOT NULL,
	`catalog_instrument_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`portfolio_instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_instrument_id`) REFERENCES `instrument_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`listing_id`) REFERENCES `instrument_catalog_listings`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
CREATE INDEX `instrument_catalog_link_identity_idx` ON `instrument_catalog_links` (`catalog_instrument_id`);
