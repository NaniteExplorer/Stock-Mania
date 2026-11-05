/**
 * Reference distributions for percentile placement (TASKS 3.8), as stored data.
 *
 * Every entry is source-labelled and dated, and states its unit (household,
 * adult or person), its measure (income or wealth) and its currency basis
 * (nominal INR, nominal USD, or PPP international dollars). Thresholds are
 * exact minor units of the stated currency basis.

 *
 * No threshold below is filled in yet: the values must be transcribed from the
 * primary source by the owner (or a verified import), and WID's data licence is
 * unresolved (TASKS.md "Blocks 3.8"). Until then each entry carries
 * `thresholds: null` with the reason, and placement refuses rather than invents.
 * Research and honest-use limits: _architecture/requirements/holding-context-percentiles.md.
 */

export type PlacementScale = "INDIA" | "WORLD";
export type PlacementMeasure = "income" | "wealth";
/** Who one observation is: a household, an adult (20+) or every person. */
export type PopulationUnit = "household" | "adult" | "person";
/** INR_NOMINAL and USD_NOMINAL are market-rate; INTL_PPP is international dollars at private-consumption PPP. */
export type CurrencyBasis = "INR_NOMINAL" | "USD_NOMINAL" | "INTL_PPP";

import type { Ordinal } from "@/core/units";

/** One cut point: `percentile` (0–100 exclusive) has this lower threshold, in minor units of the basis. */
export interface ThresholdPoint {
  /** A whole percentile rank, 1–99, as an ordinal position. */
  readonly percentile: Ordinal;
  readonly minor: bigint;
}

export interface ReferenceDistribution {
  readonly id: string;
  readonly scale: PlacementScale;
  readonly measure: PlacementMeasure;
  readonly unit: PopulationUnit;
  readonly basis: CurrencyBasis;
  /** Year the amounts are denominated in (price year). */
  readonly referenceYear: string;
  readonly source: string;
  readonly url: string;
  /** Publication date of the source, ISO. */
  readonly published: string;
  /** Ascending by percentile and amount, or null with `pendingReason`. */
  readonly thresholds: readonly ThresholdPoint[] | null;
  readonly pendingReason: string | null;
  /** Honest-use limits the screen states beside any placement. */
  readonly limits: readonly string[];
}

const PENDING = "Thresholds are not yet transcribed from the primary source and verified by the owner, so this scale cannot place you.";

export const REFERENCE_DISTRIBUTIONS: readonly ReferenceDistribution[] = Object.freeze([
  {
    id: "wid-india-income-adult",
    scale: "INDIA", measure: "income", unit: "adult", basis: "INR_NOMINAL", referenceYear: "2022",
    source: "World Inequality Database, India pre-tax national income per adult (equal-split)",
    url: "https://wid.world/country/india/", published: "2024-03-20",
    thresholds: null, pendingReason: `${PENDING} WID's data licence terms are also unresolved (TASKS.md).`,
    limits: [
      "Modelled from tax tabulations, surveys and national accounts; above roughly the 90th percentile it is a model, not an observation.",
      "National income includes items a salary does not (employer contributions, imputed rent, retained profits).",
    ],
  },
  {
    id: "wid-india-wealth-adult",
    scale: "INDIA", measure: "wealth", unit: "adult", basis: "INR_NOMINAL", referenceYear: "2022",
    source: "World Inequality Database, India net personal wealth per adult (equal-split)",
    url: "https://wid.world/document/income-and-wealth-inequality-in-india-1922-2023-the-rise-of-the-billionaire-raj-world-inequality-lab-working-paper-2024-09/",
    published: "2024-03-20",
    thresholds: null, pendingReason: `${PENDING} WID's data licence terms are also unresolved (TASKS.md).`,
    limits: ["Built on AIDIS, which under-reports financial assets and the top tail; the top decile is modelled."],
  },
  {
    id: "aidis-77-household-assets",
    scale: "INDIA", measure: "wealth", unit: "household", basis: "INR_NOMINAL", referenceYear: "2018",
    source: "NSO (MoSPI), All India Debt and Investment Survey, NSS 77th round, household asset holdings by decile",
    url: "https://mospi.gov.in/web/mospi/reports-publications",
    published: "2021-09-10",
    thresholds: null, pendingReason: PENDING,
    limits: [
      "Household, not individual: one household's assets cover everyone in it.",
      "Values as at 30 June 2018 in nominal rupees; survey under-captures financial assets and the wealthy.",
      "Gross assets by decile; debt is reported separately, so it is not net worth.",
    ],
  },
  {
    id: "plfs-earnings-person",
    scale: "INDIA", measure: "income", unit: "person", basis: "INR_NOMINAL", referenceYear: "2024",
    source: "NSO (MoSPI), Periodic Labour Force Survey annual report, average earnings by employment type",
    url: "https://mospi.gov.in/web/mospi/reports-publications",
    published: "2025-09-01",
    thresholds: null, pendingReason: `${PENDING} The published report gives averages, not percentiles; percentiles need the unit-level data.`,
    limits: ["Earnings of workers only, by employment type; not total income and not households."],
  },
  {
    id: "ubs-world-wealth-adult",
    scale: "WORLD", measure: "wealth", unit: "adult", basis: "USD_NOMINAL", referenceYear: "2024",
    source: "UBS Global Wealth Report 2025, wealth per adult and distribution by wealth band",
    url: "https://www.ubs.com/global/en/wealthmanagement/insights/global-wealth-report.html",
    published: "2025-06-18",
    thresholds: null, pendingReason: `${PENDING} The report publishes wide bands (under $10k, $10k–100k, $100k–1m, over $1m), not percentiles.`,
    limits: ["Nominal US dollars at market exchange rates, not PPP; places Indian wealth lower than its purchasing power."],
  },
  {
    id: "wb-pip-world-income-person",
    scale: "WORLD", measure: "income", unit: "person", basis: "INTL_PPP", referenceYear: "2021",
    source: "World Bank Poverty and Inequality Platform, global income/consumption distribution per person (2021 PPP)",
    url: "https://pip.worldbank.org/",
    published: "2025-06-05",
    thresholds: null, pendingReason: PENDING,
    limits: ["India's survey measures consumption, not income; mixing them understates Indian incomes.", "Per person per day, so a salary must be divided across the household."],
  },
] satisfies ReferenceDistribution[]);

/**
 * INR per international dollar, private consumption (World Bank PA.NUS.PRVT.PP), as an exact fraction.
 * Not filled in: the owner transcribes it with its year. Placement on an INTL_PPP scale refuses without it.
 */
export const PPP_SOURCE = Object.freeze({
  source: "World Bank, PPP conversion factor, private consumption (LCU per international $), PA.NUS.PRVT.PP",
  url: "https://data.worldbank.org/indicator/PA.NUS.PRVT.PP",
});
