CREATE TABLE `owner_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`born_on` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_profiles_born_on_check" CHECK(born_on IS NULL OR (length(born_on) = 10 AND born_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(born_on, '+0 days') IS born_on))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_profiles_live_user_unique` ON `owner_profiles` (`user_id`) WHERE "owner_profiles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `projection_assumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`assumption_key` text NOT NULL,
	`stated_json` text,
	`source_json` text,
	`verified_on` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projection_assumptions_key_check" CHECK(assumption_key IN ('currentAge','retirementAge','horizonAge','inflation','withdrawalRate','monthlyContribution','equityShare','blockYears','npsAnnuityShareNonGovt','npsAnnuityShareGovt')),
	CONSTRAINT "projection_assumptions_verified_on_check" CHECK(verified_on IS NULL OR (length(verified_on) = 10 AND date(verified_on, '+0 days') IS verified_on))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_assumptions_live_key_unique` ON `projection_assumptions` (`user_id`,`assumption_key`) WHERE "projection_assumptions"."deleted_at" IS NULL;