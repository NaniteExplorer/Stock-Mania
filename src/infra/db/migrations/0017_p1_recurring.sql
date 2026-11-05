CREATE TABLE `commitment_price_steps` (
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
CREATE INDEX `commitment_price_steps_user_parent_idx` ON `commitment_price_steps` (`user_id`,`commitment_id`,`from_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `commitment_price_steps_live_date_unique` ON `commitment_price_steps` (`commitment_id`,`from_date`) WHERE "commitment_price_steps"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `cover_absence_declarations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`kind` text NOT NULL,
	`declared_on` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cover_absence_kind_check" CHECK(kind IN ('HEALTH','TERM_LIFE','PERSONAL_ACCIDENT','MOTOR','HOME','OTHER')),
	CONSTRAINT "cover_absence_date_check" CHECK(declared_on IS NULL OR (length(declared_on) = 10 AND declared_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(declared_on, '+0 days') IS declared_on))
);
--> statement-breakpoint
CREATE INDEX `cover_absence_user_live_idx` ON `cover_absence_declarations` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cover_absence_live_date_unique` ON `cover_absence_declarations` (`user_id`,`kind`,`declared_on`) WHERE "cover_absence_declarations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `income_price_steps` (
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
CREATE INDEX `income_price_steps_user_parent_idx` ON `income_price_steps` (`user_id`,`stream_id`,`from_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `income_price_steps_live_date_unique` ON `income_price_steps` (`stream_id`,`from_date`) WHERE "income_price_steps"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `income_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`stream_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`posting_id` text NOT NULL,
	`received_on` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stream_id`) REFERENCES `income_streams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "income_receipts_dates_check" CHECK((occurrence_date IS NULL OR (length(occurrence_date) = 10 AND occurrence_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(occurrence_date, '+0 days') IS occurrence_date)) AND (received_on IS NULL OR (length(received_on) = 10 AND received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(received_on, '+0 days') IS received_on)))
);
--> statement-breakpoint
CREATE INDEX `income_receipts_user_stream_idx` ON `income_receipts` (`user_id`,`stream_id`,`occurrence_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `income_receipts_live_occurrence_unique` ON `income_receipts` (`stream_id`,`occurrence_date`) WHERE "income_receipts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `income_receipts_live_posting_unique` ON `income_receipts` (`posting_id`) WHERE "income_receipts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `income_streams` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`payer` text,
	`currency` text NOT NULL,
	`cadence` text NOT NULL,
	`anchor_on` text NOT NULL,
	`schedule_ends_on` text,
	`cancel_notice_days` integer,
	`grace_days` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "income_streams_fields_check" CHECK(length(trim(name,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0 AND kind IN ('SALARY','FREELANCE','BONUS','RENT','INTEREST','OTHER') AND typeof(grace_days) = 'integer' AND grace_days >= 0),
	CONSTRAINT "income_streams_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "income_streams_schedule_check" CHECK(cadence IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL') AND (cancel_notice_days IS NULL OR (typeof(cancel_notice_days) = 'integer' AND cancel_notice_days >= 0)) AND (schedule_ends_on IS NULL OR schedule_ends_on >= anchor_on)),
	CONSTRAINT "income_streams_dates_check" CHECK((anchor_on IS NULL OR (length(anchor_on) = 10 AND anchor_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(anchor_on, '+0 days') IS anchor_on)) AND (schedule_ends_on IS NULL OR (length(schedule_ends_on) = 10 AND schedule_ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(schedule_ends_on, '+0 days') IS schedule_ends_on)))
);
--> statement-breakpoint
CREATE INDEX `income_streams_user_live_idx` ON `income_streams` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`kind` text NOT NULL,
	`insurer` text NOT NULL,
	`insured` text NOT NULL,
	`currency` text NOT NULL,
	`sum_insured_minor` integer,
	`cadence` text NOT NULL,
	`anchor_on` text NOT NULL,
	`schedule_ends_on` text,
	`cancel_notice_days` integer,
	`ends_on` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "insurance_policies_fields_check" CHECK(kind IN ('HEALTH','TERM_LIFE','PERSONAL_ACCIDENT','MOTOR','HOME','OTHER') AND length(trim(insurer,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0 AND length(trim(insured,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0 AND (sum_insured_minor IS NULL OR (typeof(sum_insured_minor) = 'integer' AND sum_insured_minor > 0)) AND (ends_on IS NULL OR ends_on >= anchor_on)),
	CONSTRAINT "insurance_policies_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "insurance_policies_schedule_check" CHECK(cadence IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL') AND (cancel_notice_days IS NULL OR (typeof(cancel_notice_days) = 'integer' AND cancel_notice_days >= 0)) AND (schedule_ends_on IS NULL OR schedule_ends_on >= anchor_on)),
	CONSTRAINT "insurance_policies_dates_check" CHECK((anchor_on IS NULL OR (length(anchor_on) = 10 AND anchor_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(anchor_on, '+0 days') IS anchor_on)) AND (schedule_ends_on IS NULL OR (length(schedule_ends_on) = 10 AND schedule_ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(schedule_ends_on, '+0 days') IS schedule_ends_on)) AND (ends_on IS NULL OR (length(ends_on) = 10 AND ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(ends_on, '+0 days') IS ends_on)))
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_user_live_idx` ON `insurance_policies` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `insurance_price_steps` (
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
CREATE INDEX `insurance_price_steps_user_parent_idx` ON `insurance_price_steps` (`user_id`,`policy_id`,`from_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_price_steps_live_date_unique` ON `insurance_price_steps` (`policy_id`,`from_date`) WHERE "insurance_price_steps"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `recurring_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`cadence` text NOT NULL,
	`anchor_on` text NOT NULL,
	`schedule_ends_on` text,
	`cancel_notice_days` integer,
	`auto_renews` integer NOT NULL,
	`ends_on` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_commitments_fields_check" CHECK(length(trim(name,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0 AND kind IN ('STREAMING','MOBILE','BROADBAND','EDUCATION','MEMBERSHIP','SOFTWARE','OTHER') AND typeof(auto_renews) = 'integer' AND auto_renews IN (0,1) AND (ends_on IS NULL OR ends_on >= anchor_on)),
	CONSTRAINT "recurring_commitments_currency_check" CHECK(length(currency) = 3 AND length(CAST(currency AS BLOB)) = 3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "recurring_commitments_schedule_check" CHECK(cadence IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL') AND (cancel_notice_days IS NULL OR (typeof(cancel_notice_days) = 'integer' AND cancel_notice_days >= 0)) AND (schedule_ends_on IS NULL OR schedule_ends_on >= anchor_on)),
	CONSTRAINT "recurring_commitments_dates_check" CHECK((anchor_on IS NULL OR (length(anchor_on) = 10 AND anchor_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(anchor_on, '+0 days') IS anchor_on)) AND (schedule_ends_on IS NULL OR (length(schedule_ends_on) = 10 AND schedule_ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(schedule_ends_on, '+0 days') IS schedule_ends_on)) AND (ends_on IS NULL OR (length(ends_on) = 10 AND ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(ends_on, '+0 days') IS ends_on)))
);
--> statement-breakpoint
CREATE INDEX `recurring_commitments_user_live_idx` ON `recurring_commitments` (`user_id`,`deleted_at`);
--> statement-breakpoint
-- Owner/currency and live-parent constraints also protect raw SQL writes.
CREATE VIEW `v_insurance_policies` AS SELECT r.* FROM `insurance_policies` r WHERE r.deleted_at IS NULL;
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
