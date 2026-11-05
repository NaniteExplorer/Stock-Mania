-- Reverses 0019. Development recovery only: dropping these tables discards every
-- stored projection assumption and date of birth. Export them first if they matter:
--   SELECT * FROM projection_assumptions; SELECT * FROM owner_profiles;
-- Nothing else references either table, so no other object needs rebuilding.
DROP INDEX IF EXISTS `projection_assumptions_live_key_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `projection_assumptions`;
--> statement-breakpoint
DROP INDEX IF EXISTS `owner_profiles_live_user_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `owner_profiles`;
