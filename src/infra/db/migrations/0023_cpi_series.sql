CREATE TABLE `cpi_series` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`base` text NOT NULL,
	`index_scaled` integer NOT NULL,
	`source` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cpi_series_fields_check" CHECK(length(month) = 7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12' AND base IN ('2012','2024') AND ((month < '2026-01' AND base = '2012') OR (month >= '2026-01' AND base = '2024')) AND typeof(index_scaled) = 'integer' AND index_scaled > 0 AND length(trim(source)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cpi_series_user_month_unique` ON `cpi_series` (`user_id`,`month`);
