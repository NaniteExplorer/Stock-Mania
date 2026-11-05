CREATE TABLE `tier_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recorded_on` text NOT NULL,
	`tier` text NOT NULL,
	`earned_tier` text NOT NULL,
	`score_scaled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tier_history_fields_check" CHECK(tier IN ('LOWER','MIDDLE','UPPER') AND earned_tier IN ('LOWER','MIDDLE','UPPER') AND typeof(score_scaled) = 'integer' AND score_scaled >= 0 AND score_scaled <= 1000000),
	CONSTRAINT "tier_history_recorded_on_check" CHECK(length(recorded_on) = 10 AND recorded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(recorded_on, '+0 days') IS recorded_on)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tier_history_user_day_unique` ON `tier_history` (`user_id`,`recorded_on`);