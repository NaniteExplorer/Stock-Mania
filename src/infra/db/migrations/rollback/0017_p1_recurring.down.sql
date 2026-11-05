-- DESTRUCTIVE to newly entered P1 data: export/backup all eight tables first.
-- Development recovery only; never automatically run against the configured user DB.
DROP VIEW `v_insurance_policies`;
--> statement-breakpoint
DROP VIEW `v_insurance_price_steps`;
--> statement-breakpoint
DROP VIEW `v_recurring_commitments`;
--> statement-breakpoint
DROP VIEW `v_commitment_price_steps`;
--> statement-breakpoint
DROP VIEW `v_income_streams`;
--> statement-breakpoint
DROP VIEW `v_income_price_steps`;
--> statement-breakpoint
DROP VIEW `v_cover_absence_declarations`;
--> statement-breakpoint
DROP VIEW `v_income_receipts`;
--> statement-breakpoint
DROP TRIGGER `insurance_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `insurance_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `insurance_policies_currency_guard`;
--> statement-breakpoint
DROP TRIGGER `commitment_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `commitment_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `recurring_commitments_currency_guard`;
--> statement-breakpoint
DROP TRIGGER `income_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `income_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `income_streams_currency_guard`;
--> statement-breakpoint
DROP TRIGGER `income_receipts_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `income_receipts_update_owner`;
--> statement-breakpoint
DROP TRIGGER `income_streams_receipt_guard`;
--> statement-breakpoint
DROP TRIGGER `postings_income_receipt_guard`;
--> statement-breakpoint
DROP TRIGGER `transactions_income_receipt_guard`;
--> statement-breakpoint
DROP TRIGGER `ledger_accounts_income_receipt_guard`;
--> statement-breakpoint
DROP TABLE `income_receipts`;
--> statement-breakpoint
DROP TABLE `income_price_steps`;
--> statement-breakpoint
DROP TABLE `insurance_price_steps`;
--> statement-breakpoint
DROP TABLE `commitment_price_steps`;
--> statement-breakpoint
DROP TABLE `cover_absence_declarations`;
--> statement-breakpoint
DROP TABLE `income_streams`;
--> statement-breakpoint
DROP TABLE `insurance_policies`;
--> statement-breakpoint
DROP TABLE `recurring_commitments`;
