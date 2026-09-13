-- The priceability gate (C10) and the quoteStale degrade path (C6).
--
-- A catalogue row becomes searchable-and-addable only once a history adapter has
-- actually accepted a quote key for it, so the key, the adapter that accepted it,
-- when it was last confirmed and the source's own inception date all live on the
-- listing. `quote_stale` marks a key that has stopped resolving — symbols die
-- (`TATAMOTORS.NS` 404s after the demerger) and the row is kept, never deleted.
--
-- All additive and all nullable except the boolean, which defaults false, so the
-- migration is safe to apply to a populated catalogue: every existing row lands
-- as "never validated", which is exactly what it is.
ALTER TABLE `instrument_catalog_listings` ADD `quote_key` text;--> statement-breakpoint
ALTER TABLE `instrument_catalog_listings` ADD `quote_provider` text;--> statement-breakpoint
ALTER TABLE `instrument_catalog_listings` ADD `quote_validated_at` integer;--> statement-breakpoint
ALTER TABLE `instrument_catalog_listings` ADD `quote_stale` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `instrument_catalog_listings` ADD `first_trade_date` text;--> statement-breakpoint
ALTER TABLE `instrument_catalog_listings` ADD `moneycontrol_sc_id` text;--> statement-breakpoint
CREATE INDEX `instrument_catalog_listing_quote_key_idx` ON `instrument_catalog_listings` (`quote_key`,`quote_stale`);--> statement-breakpoint
CREATE INDEX `instrument_catalog_listing_quote_age_idx` ON `instrument_catalog_listings` (`active`,`quote_validated_at`);
