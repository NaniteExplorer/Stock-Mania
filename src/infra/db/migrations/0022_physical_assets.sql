CREATE TABLE `physical_asset_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	`asset_account_id` text NOT NULL,
	`on_date` text NOT NULL,
	`value_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_account_id`) REFERENCES `physical_assets`(`account_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "physical_asset_valuations_date_check" CHECK(on_date IS NULL OR (length(on_date) = 10 AND on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(on_date, '+0 days') IS on_date)),
	CONSTRAINT "physical_asset_valuations_value_check" CHECK(typeof(value_minor) = 'integer' AND value_minor >= 0),
	CONSTRAINT "physical_asset_valuations_currency_check" CHECK(length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "physical_asset_valuations_source_check" CHECK(source IN ('PROFESSIONAL_VALUATION','MARKET_COMPARABLE','PURCHASE_PRICE','SELF_ASSESSED'))
);
--> statement-breakpoint
CREATE INDEX `physical_asset_valuations_user_live_idx` ON `physical_asset_valuations` (`user_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `physical_asset_valuations_live_date_unique` ON `physical_asset_valuations` (`asset_account_id`,`on_date`) WHERE "physical_asset_valuations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `physical_assets` (
	`account_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`purchase_on` text,
	`purchase_price_minor` integer,
	`model_kind` text,
	`rate_percent_scaled` integer,
	`floor_percent_scaled` integer,
	`model_basis` text,
	`schedule_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "physical_assets_currency_check" CHECK(length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "physical_assets_kind_check" CHECK(kind IN ('REAL_ESTATE','VEHICLE','OTHER')),
	CONSTRAINT "physical_assets_purchase_check" CHECK((purchase_on IS NULL AND purchase_price_minor IS NULL) OR (purchase_on IS NOT NULL AND purchase_price_minor IS NOT NULL AND typeof(purchase_price_minor) = 'integer' AND purchase_price_minor > 0 AND (purchase_on IS NULL OR (length(purchase_on) = 10 AND purchase_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(purchase_on, '+0 days') IS purchase_on)))),
	CONSTRAINT "physical_assets_model_check" CHECK(coalesce((
    (model_kind IS NULL AND rate_percent_scaled IS NULL AND floor_percent_scaled IS NULL AND model_basis IS NULL AND schedule_id IS NULL)
    OR (model_kind = 'DECLINING' AND rate_percent_scaled IS NOT NULL AND typeof(rate_percent_scaled) = 'integer' AND rate_percent_scaled >= 0 AND rate_percent_scaled < 100000000 AND floor_percent_scaled IS NULL AND (model_basis IS NOT NULL AND length(trim(model_basis,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0) AND schedule_id IS NULL)
    OR (model_kind = 'STRAIGHT' AND rate_percent_scaled IS NOT NULL AND typeof(rate_percent_scaled) = 'integer' AND rate_percent_scaled > 0 AND floor_percent_scaled IS NOT NULL AND typeof(floor_percent_scaled) = 'integer' AND floor_percent_scaled >= 0 AND floor_percent_scaled <= 100000000 AND (model_basis IS NOT NULL AND length(trim(model_basis,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))) > 0) AND schedule_id IS NULL)
    OR (model_kind = 'SCHEDULE' AND schedule_id IS NOT NULL AND schedule_id = 'MOTOR_IDV' AND rate_percent_scaled IS NULL AND floor_percent_scaled IS NULL AND model_basis IS NULL)
  ), 0))
);
--> statement-breakpoint
CREATE INDEX `physical_assets_user_live_idx` ON `physical_assets` (`user_id`,`deleted_at`);
--> statement-breakpoint
CREATE TRIGGER physical_assets_guard_insert BEFORE INSERT ON physical_assets BEGIN
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id AND a.type='ASSET' AND a.subtype=NEW.kind AND a.currency=NEW.currency AND (NEW.deleted_at IS NOT NULL OR a.deleted_at IS NULL) AND a.is_system=0) THEN RAISE(ABORT,'physical asset account is not live, owned and eligible') END;
SELECT CASE WHEN NEW.purchase_on IS NOT NULL AND EXISTS (SELECT 1 FROM physical_asset_valuations v WHERE v.asset_account_id=NEW.account_id AND v.deleted_at IS NULL AND v.on_date<NEW.purchase_on) THEN RAISE(ABORT,'physical assertion precedes purchase') END;
SELECT CASE WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM asset_acquisitions l JOIN postings p ON p.id=l.posting_id JOIN transactions t ON t.id=p.transaction_id JOIN ledger_accounts a ON a.id=NEW.account_id WHERE l.asset_account_id=NEW.account_id AND l.deleted_at IS NULL AND (l.user_id<>NEW.user_id OR (NEW.purchase_on IS NOT NULL AND (t.txn_date<>NEW.purchase_on OR p.amount_minor<>NEW.purchase_price_minor OR p.currency<>a.currency)))) THEN RAISE(ABORT,'physical purchase conflicts with linked acquisition') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_assets_guard_update BEFORE UPDATE ON physical_assets BEGIN
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger_accounts a WHERE a.id=NEW.account_id AND a.user_id=NEW.user_id AND a.type='ASSET' AND a.subtype=NEW.kind AND a.currency=NEW.currency AND (NEW.deleted_at IS NOT NULL OR a.deleted_at IS NULL) AND a.is_system=0) THEN RAISE(ABORT,'physical asset account is not live, owned and eligible') END;
SELECT CASE WHEN NEW.purchase_on IS NOT NULL AND EXISTS (SELECT 1 FROM physical_asset_valuations v WHERE v.asset_account_id=NEW.account_id AND v.deleted_at IS NULL AND v.on_date<NEW.purchase_on) THEN RAISE(ABORT,'physical assertion precedes purchase') END;
SELECT CASE WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM asset_acquisitions l JOIN postings p ON p.id=l.posting_id JOIN transactions t ON t.id=p.transaction_id JOIN ledger_accounts a ON a.id=NEW.account_id WHERE l.asset_account_id=NEW.account_id AND l.deleted_at IS NULL AND (l.user_id<>NEW.user_id OR (NEW.purchase_on IS NOT NULL AND (t.txn_date<>NEW.purchase_on OR p.amount_minor<>NEW.purchase_price_minor OR p.currency<>a.currency)))) THEN RAISE(ABORT,'physical purchase conflicts with linked acquisition') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_asset_valuations_guard_insert BEFORE INSERT ON physical_asset_valuations BEGIN
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM physical_assets h JOIN ledger_accounts a ON a.id=h.account_id WHERE h.account_id=NEW.asset_account_id AND h.user_id=NEW.user_id AND a.user_id=NEW.user_id AND a.currency=NEW.currency AND h.currency=NEW.currency AND (NEW.deleted_at IS NOT NULL OR (h.deleted_at IS NULL AND a.deleted_at IS NULL)) AND (h.purchase_on IS NULL OR NEW.on_date>=h.purchase_on)) THEN RAISE(ABORT,'physical assertion parent, owner or purchase date invalid') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_asset_valuations_guard_update BEFORE UPDATE ON physical_asset_valuations BEGIN
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM physical_assets h JOIN ledger_accounts a ON a.id=h.account_id WHERE h.account_id=NEW.asset_account_id AND h.user_id=NEW.user_id AND a.user_id=NEW.user_id AND a.currency=NEW.currency AND h.currency=NEW.currency AND (NEW.deleted_at IS NOT NULL OR (h.deleted_at IS NULL AND a.deleted_at IS NULL)) AND (h.purchase_on IS NULL OR NEW.on_date>=h.purchase_on)) THEN RAISE(ABORT,'physical assertion parent, owner or purchase date invalid') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_acquisition_guard_insert BEFORE INSERT ON asset_acquisitions BEGIN
SELECT CASE WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM physical_assets h JOIN ledger_accounts a ON a.id=h.account_id WHERE h.account_id=NEW.asset_account_id AND h.deleted_at IS NULL AND (h.user_id<>NEW.user_id OR (h.purchase_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM postings p JOIN transactions t ON t.id=p.transaction_id WHERE p.id=NEW.posting_id AND t.txn_date=h.purchase_on AND p.amount_minor=h.purchase_price_minor AND p.currency=a.currency)))) THEN RAISE(ABORT,'acquisition conflicts with physical purchase') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_acquisition_guard_update BEFORE UPDATE ON asset_acquisitions BEGIN
SELECT CASE WHEN NEW.deleted_at IS NULL AND EXISTS (SELECT 1 FROM physical_assets h JOIN ledger_accounts a ON a.id=h.account_id WHERE h.account_id=NEW.asset_account_id AND h.deleted_at IS NULL AND (h.user_id<>NEW.user_id OR (h.purchase_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM postings p JOIN transactions t ON t.id=p.transaction_id WHERE p.id=NEW.posting_id AND t.txn_date=h.purchase_on AND p.amount_minor=h.purchase_price_minor AND p.currency=a.currency)))) THEN RAISE(ABORT,'acquisition conflicts with physical purchase') END;
END;

--> statement-breakpoint
CREATE TRIGGER physical_assets_identity_guard BEFORE UPDATE ON physical_assets WHEN NEW.account_id<>OLD.account_id OR NEW.user_id<>OLD.user_id OR NEW.kind<>OLD.kind OR NEW.currency<>OLD.currency BEGIN SELECT RAISE(ABORT,'physical asset identity is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER physical_asset_valuations_identity_guard BEFORE UPDATE ON physical_asset_valuations WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.asset_account_id<>OLD.asset_account_id OR NEW.currency<>OLD.currency BEGIN SELECT RAISE(ABORT,'physical assertion identity is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER physical_posting_purchase_guard BEFORE UPDATE OF amount_minor,currency,transaction_id ON postings WHEN EXISTS (SELECT 1 FROM asset_acquisitions l JOIN physical_assets h ON h.account_id=l.asset_account_id JOIN ledger_accounts a ON a.id=h.account_id JOIN transactions t ON t.id=NEW.transaction_id WHERE l.posting_id=OLD.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.purchase_on IS NOT NULL AND (NEW.amount_minor<>h.purchase_price_minor OR NEW.currency<>a.currency OR t.txn_date<>h.purchase_on)) BEGIN SELECT RAISE(ABORT,'posting edit conflicts with physical purchase'); END;

--> statement-breakpoint
CREATE TRIGGER physical_transaction_purchase_guard BEFORE UPDATE OF txn_date ON transactions WHEN EXISTS (SELECT 1 FROM postings p JOIN asset_acquisitions l ON l.posting_id=p.id JOIN physical_assets h ON h.account_id=l.asset_account_id WHERE p.transaction_id=OLD.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.purchase_on IS NOT NULL AND NEW.txn_date<>h.purchase_on) BEGIN SELECT RAISE(ABORT,'transaction date conflicts with physical purchase'); END;

--> statement-breakpoint
CREATE VIEW v_physical_assets AS SELECT * FROM physical_assets WHERE deleted_at IS NULL;

--> statement-breakpoint
CREATE VIEW v_physical_asset_valuations AS SELECT * FROM physical_asset_valuations WHERE deleted_at IS NULL;

--> statement-breakpoint
CREATE TRIGGER physical_account_identity_guard BEFORE UPDATE OF id,user_id,currency,type,subtype,is_system ON ledger_accounts
WHEN EXISTS (SELECT 1 FROM physical_assets h WHERE h.account_id=OLD.id)
AND (NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.currency IS NOT OLD.currency OR NEW.type IS NOT OLD.type OR NEW.subtype IS NOT OLD.subtype OR NEW.is_system IS NOT OLD.is_system)
BEGIN SELECT RAISE(ABORT,'physical asset account owner, currency and classification are immutable'); END;
