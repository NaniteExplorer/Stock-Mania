-- Reverses 0023. Development recovery only: dropping the table discards every
-- CPI figure the owner typed, and the net-worth chart falls back to "real is
-- unknown" (the behaviour before 0023). Export first if the figures matter:
--   SELECT * FROM cpi_series;
-- Nothing references this table, so no other object needs rebuilding.
DROP INDEX IF EXISTS `cpi_series_user_month_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `cpi_series`;
