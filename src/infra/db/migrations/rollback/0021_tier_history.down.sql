-- Reverses 0021. Development recovery only: dropping the table discards every
-- recorded tier, and demotion hysteresis falls back to `previous = null` (the
-- behaviour before 0021). Export first if the history matters:
--   SELECT * FROM tier_history;
-- Nothing references this table, so no other object needs rebuilding.
DROP INDEX IF EXISTS `tier_history_user_day_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `tier_history`;
