-- How a lease actually pays, rather than assuming it pays monthly in grams.
--
-- The old model accrued on every completed month and credited grams into the
-- holding. Both were true of one product and not of the others: a lease that
-- pays quarterly has credited nothing in month two, and a lease that pays in
-- rupees leaves the grams exactly where they were. Accruing monthly regardless
-- showed gold that had not arrived, in a holding the user might then lease again.
--
-- Defaults reproduce the old behaviour exactly, so every existing lease keeps
-- the numbers it already showed.

ALTER TABLE `gold_leases` ADD `payout_frequency` text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint

ALTER TABLE `gold_leases` ADD `payout_mode` text DEFAULT 'GRAMS' NOT NULL;--> statement-breakpoint

-- Where a cash payout lands. Null for a grams lease, which is most of them.
ALTER TABLE `gold_leases` ADD `payout_account_id` text REFERENCES `ledger_accounts`(`id`);
