-- Reverses 0025. Development recovery only: dropping these tables discards the
-- owner's stored rebalancing band (the signals board falls back to "no band is
-- stored") and every minimum due typed from a card statement (the cards screen
-- falls back to the card's percentage-and-floor rule). Export first if it matters:
--   SELECT * FROM rebalancing_bands;
--   SELECT * FROM card_minimum_dues;
-- Nothing references these tables, so no other object needs rebuilding.
DROP INDEX IF EXISTS `rebalancing_bands_user_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `rebalancing_bands`;
--> statement-breakpoint
DROP INDEX IF EXISTS `card_minimum_dues_user_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `card_minimum_dues_account_statement_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `card_minimum_dues`;
