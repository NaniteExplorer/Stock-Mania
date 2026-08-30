-- The platform a holding lives on, promoted from free text to a row.
--
-- `institutions` has existed since the baseline and was referenced by nothing.
-- Two columns now point at it: an instrument's platform and a lease's platform.
-- Both are nullable, because every row that already exists has no platform and inventing
-- one would be a guess.
--
-- The free-text columns (`gold_leases.platform`, `ledger_accounts.institution`)
-- are deliberately left in place. They are what a backfill reads to match a
-- typed name to a row, and dropping them would destroy the only record of what
-- the user actually wrote.
--
-- `ledger_accounts` gets no FK of its own. A platform's holdings are found
-- through `instruments.institution_id`, and the account tree already groups them
-- under `Assets:Investments:<Platform>` — a third way to say the same thing is a
-- third thing to keep in step.

ALTER TABLE `instruments` ADD `institution_id` text REFERENCES `institutions`(`id`);--> statement-breakpoint

ALTER TABLE `gold_leases` ADD `institution_id` text REFERENCES `institutions`(`id`);--> statement-breakpoint

-- Platforms a user has archived stay readable (a closed Zerodha account still
-- has history) but drop out of every picker.
ALTER TABLE `institutions` ADD `is_archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE `institutions` ADD `notes` text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `instruments_user_institution_idx` ON `instruments` (`user_id`,`institution_id`);
