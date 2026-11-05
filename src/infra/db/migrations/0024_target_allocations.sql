CREATE TABLE `target_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sleeve_id` text NOT NULL,
	`share_scaled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "target_allocations_fields_check" CHECK(length(trim(sleeve_id)) > 0 AND typeof(share_scaled) = 'integer' AND share_scaled > 0 AND share_scaled <= 100000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `target_allocations_user_sleeve_unique` ON `target_allocations` (`user_id`,`sleeve_id`);
