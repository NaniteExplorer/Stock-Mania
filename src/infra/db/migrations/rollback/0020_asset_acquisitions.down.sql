-- Reverses 0020. Development recovery only: dropping the table discards every
-- stored expense-to-asset link. No posting, transaction or account is touched,
-- so every balance is unchanged. Export the links first if they matter:
--   SELECT * FROM asset_acquisitions;
-- Roll back 0021 first if it is applied (journal order). Nothing references this table.
DROP INDEX IF EXISTS `asset_acquisitions_live_posting_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `asset_acquisitions_live_asset_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `asset_acquisitions_user_live_idx`;
--> statement-breakpoint
DROP TABLE IF EXISTS `asset_acquisitions`;
