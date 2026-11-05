-- Reverses 0024. Development recovery only: dropping the table discards the
-- owner's stored target allocation, and the signals board falls back to "no
-- target allocation is stored" (the behaviour before 0024). Export first if it
-- matters:
--   SELECT * FROM target_allocations;
-- Nothing references this table, so no other object needs rebuilding.
DROP INDEX IF EXISTS `target_allocations_user_sleeve_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `target_allocations`;
