CREATE TABLE `price_bars` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`granularity` text DEFAULT 'DAY' NOT NULL,
	`as_of` text NOT NULL,
	`open_scaled` integer NOT NULL,
	`high_scaled` integer NOT NULL,
	`low_scaled` integer NOT NULL,
	`close_scaled` integer NOT NULL,
	`volume` integer,
	`currency` text(3) DEFAULT 'INR' NOT NULL,
	`provider_id` text DEFAULT 'manual' NOT NULL,
	`ingested_at` integer NOT NULL,
	`superseded_by` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "price_bars_positive" CHECK("price_bars"."low_scaled" > 0),
	CONSTRAINT "price_bars_high_not_below_low" CHECK("price_bars"."high_scaled" >= "price_bars"."low_scaled"),
	CONSTRAINT "price_bars_open_close_within_range" CHECK("price_bars"."open_scaled" BETWEEN "price_bars"."low_scaled" AND "price_bars"."high_scaled"
          AND "price_bars"."close_scaled" BETWEEN "price_bars"."low_scaled" AND "price_bars"."high_scaled"),
	CONSTRAINT "price_bars_volume_not_negative" CHECK("price_bars"."volume" IS NULL OR "price_bars"."volume" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_bars_bitemporal_uq` ON `price_bars` (`instrument_id`,`granularity`,`as_of`,`provider_id`,`ingested_at`);--> statement-breakpoint
CREATE INDEX `price_bars_series_idx` ON `price_bars` (`instrument_id`,`granularity`,`as_of`);--> statement-breakpoint
ALTER TABLE `instruments` ADD `metadata` text;