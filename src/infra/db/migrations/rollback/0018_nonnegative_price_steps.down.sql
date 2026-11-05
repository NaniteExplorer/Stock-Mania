-- Restores 0017 price constraints without deleting history. Development recovery only.
DROP TRIGGER `insurance_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `insurance_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `insurance_policies_currency_guard`;
--> statement-breakpoint
DROP VIEW `v_insurance_price_steps`;
--> statement-breakpoint
DROP VIEW `v_recurring_commitments`;
--> statement-breakpoint
DROP TRIGGER `commitment_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `commitment_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `recurring_commitments_currency_guard`;
--> statement-breakpoint
DROP VIEW `v_commitment_price_steps`;
--> statement-breakpoint
DROP VIEW `v_income_streams`;
--> statement-breakpoint
DROP TRIGGER `income_price_steps_insert_owner`;
--> statement-breakpoint
DROP TRIGGER `income_price_steps_update_owner`;
--> statement-breakpoint
DROP TRIGGER `income_streams_currency_guard`;
--> statement-breakpoint
DROP VIEW `v_income_price_steps`;
--> statement-breakpoint
DROP VIEW `v_cover_absence_declarations`;
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
DROP VIEW `v_income_receipts`;
--> statement-breakpoint
CREATE TABLE `__new_insurance_price_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`policy_id` text NOT NULL,
	`from_date` text NOT NULL,
	`amount_minor` integer,
	`currency` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "insurance_price_steps_amount_check" CHECK(amount_minor IS NULL OR typeof(amount_minor) = 'integer'),
	CONSTRAINT "insurance_price_steps_date_check" CHECK(from_date IS NULL OR (length(from_date) = 10 AND from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(from_date, '+0 days') IS from_date)),
	CONSTRAINT "insurance_price_steps_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_price_steps` SELECT * FROM `insurance_price_steps`;
--> statement-breakpoint
DROP TABLE `insurance_price_steps`;
--> statement-breakpoint
ALTER TABLE `__new_insurance_price_steps` RENAME TO `insurance_price_steps`;
--> statement-breakpoint
CREATE INDEX `insurance_price_steps_user_parent_idx` ON `insurance_price_steps` (`user_id`,`policy_id`,`from_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_price_steps_live_date_unique` ON `insurance_price_steps` (`policy_id`,`from_date`) WHERE "insurance_price_steps"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE `__new_commitment_price_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`commitment_id` text NOT NULL,
	`from_date` text NOT NULL,
	`amount_minor` integer,
	`currency` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`commitment_id`) REFERENCES `recurring_commitments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "commitment_price_steps_amount_check" CHECK(amount_minor IS NULL OR typeof(amount_minor) = 'integer'),
	CONSTRAINT "commitment_price_steps_date_check" CHECK(from_date IS NULL OR (length(from_date) = 10 AND from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(from_date, '+0 days') IS from_date)),
	CONSTRAINT "commitment_price_steps_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*')
);
--> statement-breakpoint
INSERT INTO `__new_commitment_price_steps` SELECT * FROM `commitment_price_steps`;
--> statement-breakpoint
DROP TABLE `commitment_price_steps`;
--> statement-breakpoint
ALTER TABLE `__new_commitment_price_steps` RENAME TO `commitment_price_steps`;
--> statement-breakpoint
CREATE INDEX `commitment_price_steps_user_parent_idx` ON `commitment_price_steps` (`user_id`,`commitment_id`,`from_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `commitment_price_steps_live_date_unique` ON `commitment_price_steps` (`commitment_id`,`from_date`) WHERE "commitment_price_steps"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE `__new_income_price_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`stream_id` text NOT NULL,
	`from_date` text NOT NULL,
	`amount_minor` integer,
	`currency` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stream_id`) REFERENCES `income_streams`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "income_price_steps_amount_check" CHECK(amount_minor IS NULL OR typeof(amount_minor) = 'integer'),
	CONSTRAINT "income_price_steps_date_check" CHECK(from_date IS NULL OR (length(from_date) = 10 AND from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(from_date, '+0 days') IS from_date)),
	CONSTRAINT "income_price_steps_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*')
);
--> statement-breakpoint
INSERT INTO `__new_income_price_steps` SELECT * FROM `income_price_steps`;
--> statement-breakpoint
DROP TABLE `income_price_steps`;
--> statement-breakpoint
ALTER TABLE `__new_income_price_steps` RENAME TO `income_price_steps`;
--> statement-breakpoint
CREATE INDEX `income_price_steps_user_parent_idx` ON `income_price_steps` (`user_id`,`stream_id`,`from_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `income_price_steps_live_date_unique` ON `income_price_steps` (`stream_id`,`from_date`) WHERE "income_price_steps"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE TRIGGER `insurance_price_steps_insert_owner` BEFORE INSERT ON `insurance_price_steps` WHEN NOT EXISTS (SELECT 1 FROM insurance_policies p WHERE p.id = NEW.policy_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `insurance_price_steps_update_owner` BEFORE UPDATE ON `insurance_price_steps` WHEN NOT EXISTS (SELECT 1 FROM insurance_policies p WHERE p.id = NEW.policy_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `insurance_policies_currency_guard` BEFORE UPDATE OF user_id, currency ON `insurance_policies` WHEN EXISTS (SELECT 1 FROM insurance_price_steps c WHERE c.policy_id = OLD.id AND (c.user_id != NEW.user_id OR c.currency != NEW.currency)) BEGIN SELECT RAISE(ABORT, 'P1 parent change conflicts with price history'); END;
--> statement-breakpoint
CREATE VIEW `v_insurance_price_steps` AS SELECT r.* FROM `insurance_price_steps` r WHERE r.deleted_at IS NULL AND EXISTS (SELECT 1 FROM insurance_policies p WHERE p.id = r.policy_id AND p.user_id = r.user_id AND p.currency = r.currency AND p.deleted_at IS NULL);
--> statement-breakpoint
CREATE VIEW `v_recurring_commitments` AS SELECT r.* FROM `recurring_commitments` r WHERE r.deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `commitment_price_steps_insert_owner` BEFORE INSERT ON `commitment_price_steps` WHEN NOT EXISTS (SELECT 1 FROM recurring_commitments p WHERE p.id = NEW.commitment_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `commitment_price_steps_update_owner` BEFORE UPDATE ON `commitment_price_steps` WHEN NOT EXISTS (SELECT 1 FROM recurring_commitments p WHERE p.id = NEW.commitment_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `recurring_commitments_currency_guard` BEFORE UPDATE OF user_id, currency ON `recurring_commitments` WHEN EXISTS (SELECT 1 FROM commitment_price_steps c WHERE c.commitment_id = OLD.id AND (c.user_id != NEW.user_id OR c.currency != NEW.currency)) BEGIN SELECT RAISE(ABORT, 'P1 parent change conflicts with price history'); END;
--> statement-breakpoint
CREATE VIEW `v_commitment_price_steps` AS SELECT r.* FROM `commitment_price_steps` r WHERE r.deleted_at IS NULL AND EXISTS (SELECT 1 FROM recurring_commitments p WHERE p.id = r.commitment_id AND p.user_id = r.user_id AND p.currency = r.currency AND p.deleted_at IS NULL);
--> statement-breakpoint
CREATE VIEW `v_income_streams` AS SELECT r.* FROM `income_streams` r WHERE r.deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `income_price_steps_insert_owner` BEFORE INSERT ON `income_price_steps` WHEN NOT EXISTS (SELECT 1 FROM income_streams p WHERE p.id = NEW.stream_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `income_price_steps_update_owner` BEFORE UPDATE ON `income_price_steps` WHEN NOT EXISTS (SELECT 1 FROM income_streams p WHERE p.id = NEW.stream_id AND p.user_id = NEW.user_id AND p.currency = NEW.currency AND (NEW.deleted_at IS NOT NULL OR p.deleted_at IS NULL)) BEGIN SELECT RAISE(ABORT, 'P1 parent owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `income_streams_currency_guard` BEFORE UPDATE OF user_id, currency ON `income_streams` WHEN EXISTS (SELECT 1 FROM income_price_steps c WHERE c.stream_id = OLD.id AND (c.user_id != NEW.user_id OR c.currency != NEW.currency)) BEGIN SELECT RAISE(ABORT, 'P1 parent change conflicts with price history'); END;
--> statement-breakpoint
CREATE VIEW `v_income_price_steps` AS SELECT r.* FROM `income_price_steps` r WHERE r.deleted_at IS NULL AND EXISTS (SELECT 1 FROM income_streams p WHERE p.id = r.stream_id AND p.user_id = r.user_id AND p.currency = r.currency AND p.deleted_at IS NULL);
--> statement-breakpoint
CREATE VIEW `v_cover_absence_declarations` AS SELECT r.* FROM `cover_absence_declarations` r WHERE r.deleted_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER `income_receipts_insert_owner` BEFORE INSERT ON `income_receipts` WHEN NOT EXISTS (SELECT 1 FROM income_streams s JOIN postings p ON p.id = NEW.posting_id JOIN transactions t ON t.id = p.transaction_id JOIN ledger_accounts a ON a.id = p.account_id WHERE s.id = NEW.stream_id AND s.user_id = NEW.user_id AND t.user_id = NEW.user_id AND a.user_id = NEW.user_id AND s.currency = p.currency AND a.currency = p.currency AND (NEW.deleted_at IS NOT NULL OR (s.deleted_at IS NULL AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND a.deleted_at IS NULL))) BEGIN SELECT RAISE(ABORT, 'P1 receipt parent, posting owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `income_receipts_update_owner` BEFORE UPDATE ON `income_receipts` WHEN NOT EXISTS (SELECT 1 FROM income_streams s JOIN postings p ON p.id = NEW.posting_id JOIN transactions t ON t.id = p.transaction_id JOIN ledger_accounts a ON a.id = p.account_id WHERE s.id = NEW.stream_id AND s.user_id = NEW.user_id AND t.user_id = NEW.user_id AND a.user_id = NEW.user_id AND s.currency = p.currency AND a.currency = p.currency AND (NEW.deleted_at IS NOT NULL OR (s.deleted_at IS NULL AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND a.deleted_at IS NULL))) BEGIN SELECT RAISE(ABORT, 'P1 receipt parent, posting owner, currency or live state mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `income_streams_receipt_guard` BEFORE UPDATE OF user_id, currency ON `income_streams` WHEN EXISTS (SELECT 1 FROM income_receipts r JOIN postings p ON p.id = r.posting_id WHERE r.stream_id = OLD.id AND (r.user_id != NEW.user_id OR p.currency != NEW.currency)) BEGIN SELECT RAISE(ABORT, 'P1 stream change conflicts with receipt history'); END;
--> statement-breakpoint
CREATE TRIGGER `postings_income_receipt_guard` BEFORE UPDATE OF transaction_id, account_id, currency ON `postings` WHEN EXISTS (SELECT 1 FROM income_receipts r JOIN income_streams s ON s.id = r.stream_id WHERE r.posting_id = OLD.id AND (s.currency != NEW.currency OR NOT EXISTS (SELECT 1 FROM transactions t JOIN ledger_accounts a ON a.id = NEW.account_id WHERE t.id = NEW.transaction_id AND t.user_id = r.user_id AND a.user_id = r.user_id AND a.currency = NEW.currency))) BEGIN SELECT RAISE(ABORT, 'P1 posting change conflicts with receipt history'); END;
--> statement-breakpoint
CREATE TRIGGER `transactions_income_receipt_guard` BEFORE UPDATE OF user_id ON `transactions` WHEN EXISTS (SELECT 1 FROM postings p JOIN income_receipts r ON r.posting_id = p.id WHERE p.transaction_id = OLD.id AND r.user_id != NEW.user_id) BEGIN SELECT RAISE(ABORT, 'P1 transaction owner conflicts with receipt history'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_accounts_income_receipt_guard` BEFORE UPDATE OF user_id, currency ON `ledger_accounts` WHEN EXISTS (SELECT 1 FROM postings p JOIN income_receipts r ON r.posting_id = p.id WHERE p.account_id = OLD.id AND (r.user_id != NEW.user_id OR p.currency != NEW.currency)) BEGIN SELECT RAISE(ABORT, 'P1 account change conflicts with receipt history'); END;
--> statement-breakpoint
CREATE VIEW `v_income_receipts` AS SELECT r.* FROM `income_receipts` r WHERE r.deleted_at IS NULL AND EXISTS (SELECT 1 FROM income_streams s JOIN postings p ON p.id = r.posting_id JOIN transactions t ON t.id = p.transaction_id JOIN ledger_accounts a ON a.id = p.account_id WHERE s.id = r.stream_id AND s.user_id = r.user_id AND t.user_id = r.user_id AND a.user_id = r.user_id AND s.currency = p.currency AND a.currency = p.currency AND s.deleted_at IS NULL AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND a.deleted_at IS NULL);
