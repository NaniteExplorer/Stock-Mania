-- A per-unit price rounded to paise cannot reconstruct every exact consideration
-- (for example, INR 33,950 across 5.25 grams). Keep the existing display/search
-- rate and add the authoritative original lot cost. Existing rows remain nullable
-- and continue through the legacy mapper fallback until rewritten.
ALTER TABLE `lots` ADD `cost_minor` integer;
