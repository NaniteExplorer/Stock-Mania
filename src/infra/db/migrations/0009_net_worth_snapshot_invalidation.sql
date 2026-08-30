-- net_worth_snapshots is acceleration data only. Any journal mutation that can
-- change a month-end balance removes that month and every later cumulative point.
CREATE TRIGGER IF NOT EXISTS `net_worth_snapshots_transaction_insert`
AFTER INSERT ON `transactions`
BEGIN
  DELETE FROM `net_worth_snapshots`
   WHERE `user_id` = NEW.`user_id`
     AND `month` >= substr(NEW.`txn_date`, 1, 7);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `net_worth_snapshots_transaction_update`
AFTER UPDATE OF `txn_date`, `deleted_at` ON `transactions`
BEGIN
  DELETE FROM `net_worth_snapshots`
   WHERE `user_id` = NEW.`user_id`
     AND `month` >= min(substr(OLD.`txn_date`, 1, 7), substr(NEW.`txn_date`, 1, 7));
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `net_worth_snapshots_transaction_delete`
AFTER DELETE ON `transactions`
BEGIN
  DELETE FROM `net_worth_snapshots`
   WHERE `user_id` = OLD.`user_id`
     AND `month` >= substr(OLD.`txn_date`, 1, 7);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `net_worth_snapshots_posting_update`
AFTER UPDATE OF `amount_minor`, `direction`, `account_id`, `deleted_at` ON `postings`
BEGIN
  DELETE FROM `net_worth_snapshots`
   WHERE `user_id` = (SELECT `user_id` FROM `transactions` WHERE `id` = NEW.`transaction_id`)
     AND `month` >= (SELECT substr(`txn_date`, 1, 7) FROM `transactions` WHERE `id` = NEW.`transaction_id`);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `net_worth_snapshots_account_update`
AFTER UPDATE OF `type`, `deleted_at` ON `ledger_accounts`
BEGIN
  DELETE FROM `net_worth_snapshots` WHERE `user_id` = NEW.`user_id`;
END;
