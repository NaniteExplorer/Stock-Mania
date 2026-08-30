-- What a platform actually pays you back, as a discount to the benchmark.
--
-- Digital gold has two prices, and until now the app only knew one of them. You
-- buy at the platform's buy rate plus 3% GST; you sell at its sell rate, which
-- sits a few percent *below* the IBJA benchmark the app values the holding at.
-- The round trip costs 3-6% before the metal has moved at all, and a portfolio
-- priced at the benchmark shows a gain on the morning after a purchase that
-- nobody could actually realise.
--
-- Stored per platform rather than globally, because the spread is a commercial
-- decision each vault makes for itself: SafeGold, MMTC-PAMP and Augmont do not
-- agree, and one number for all three is wrong for at least two of them.
--
-- Zero by default, which keeps every existing row valuing exactly as it does
-- today. A spread nobody has entered is not assumed — an invented 4% would be a
-- number the user never supplied appearing in their net worth.

ALTER TABLE `institutions` ADD `sell_spread_scaled` integer DEFAULT 0 NOT NULL;
