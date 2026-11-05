import { kindLabel } from "@/domain/asset-groups";
import { check, done, section } from "./harness";

section("kindLabel");
check("listed equity with no currency keeps its plain label", kindLabel("LISTED_EQUITY"), "Listed equity");
check("an Indian listing is Indian equity", kindLabel("LISTED_EQUITY", "INR"), "Indian equity");
check("any other currency is foreign equity", kindLabel("LISTED_EQUITY", "USD"), "Foreign equity");
check("a currency does not split a kind that has no market rule", kindLabel("ETF", "USD"), "ETF");
check("and without one it is the same", kindLabel("ETF"), "ETF");

done();
