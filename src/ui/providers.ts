/**
 * Indian banks, brokers, wallets and retirement schemes — name, domain and any
 * curated local logo asset.
 *
 * Moved out of v1's `lib/`. Pure data with no dependencies, used by the logo
 * proxy at `app/api/logo/[id]/` and (from Phase 2) by the account-opening form.
 */
/**
 * `BULLION` is its own kind rather than a `BROKER`: a vaulting provider holds
 * metal against your name and executes no trades, and it is the only kind that
 * offers a gold lease. A form asking "which platform" for digital gold offers
 * these and not the brokers.
 */
export type ProviderKind = "BANK" | "RETIREMENT" | "SAVINGS" | "WALLET" | "BROKER" | "BULLION";

export interface FinancialProvider {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  kind: ProviderKind;
  country: string;
  colors: [string, string];
  /** Website domain — used to fetch a logo from Google's favicon service. */
  domain?: string;
  /**
   * Optional local logo asset, preferred over every remote source.
   *
   * Reserved for a file obtained from the institution itself — a press-kit or
   * brand-guidelines asset. It shipped with five hand-traced approximations
   * instead, and because a curated asset outranks everything, those *displaced*
   * the real favicon: Axis and HDFC both publish a usable one, and the app drew
   * its own two-triangle sketch over the top. A logo is an identity claim, so a
   * near-miss here is worse than no logo at all — the branded badge in
   * `ProviderMark` at least does not pretend to be the bank's mark.
   */
  logo?: string;
}

export const FINANCIAL_PROVIDERS: FinancialProvider[] = [
  // Indian banks
  { id: "sbi", name: "State Bank of India", shortName: "SBI", aliases: ["state bank"], kind: "BANK", country: "IN", colors: ["#00A6E2", "#0867A9"], domain: "sbi.co.in" },
  { id: "hdfc", name: "HDFC Bank", shortName: "HDFC", aliases: ["housing development finance"], kind: "BANK", country: "IN", colors: ["#E31E24", "#004C8F"], domain: "hdfcbank.com" },
  { id: "axis", name: "Axis Bank", shortName: "AXIS", aliases: ["uti bank"], kind: "BANK", country: "IN", colors: ["#97144D", "#5E1236"], domain: "axisbank.com" },
  { id: "icici", name: "ICICI Bank", shortName: "ICICI", aliases: [], kind: "BANK", country: "IN", colors: ["#F58220", "#A51C30"], domain: "icicibank.com" },
  { id: "kotak", name: "Kotak Mahindra Bank", shortName: "KOTAK", aliases: ["kotak 811"], kind: "BANK", country: "IN", colors: ["#ED1C24", "#123B72"], domain: "kotak.com" },
  { id: "bob", name: "Bank of Baroda", shortName: "BOB", aliases: ["baroda"], kind: "BANK", country: "IN", colors: ["#F26522", "#E64618"], domain: "bankofbaroda.in" },
  { id: "pnb", name: "Punjab National Bank", shortName: "PNB", aliases: [], kind: "BANK", country: "IN", colors: ["#A20B35", "#F5A623"], domain: "pnbindia.in" },
  { id: "canara", name: "Canara Bank", shortName: "CANARA", aliases: [], kind: "BANK", country: "IN", colors: ["#00AEEF", "#FFC20E"], domain: "canarabank.com" },
  { id: "union-bank", name: "Union Bank of India", shortName: "UNION", aliases: [], kind: "BANK", country: "IN", colors: ["#E31E24", "#00529B"], domain: "unionbankofindia.co.in" },
  { id: "bank-of-india", name: "Bank of India", shortName: "BOI", aliases: [], kind: "BANK", country: "IN", colors: ["#F47920", "#1B3F8B"], domain: "bankofindia.co.in" },
  { id: "indian-bank", name: "Indian Bank", shortName: "INDB", aliases: [], kind: "BANK", country: "IN", colors: ["#1A4D8F", "#0E2E57"], domain: "indianbank.in" },
  { id: "central-bank", name: "Central Bank of India", shortName: "CBI", aliases: [], kind: "BANK", country: "IN", colors: ["#0E4C92", "#062A52"], domain: "centralbankofindia.co.in" },
  { id: "indusind", name: "IndusInd Bank", shortName: "INDUS", aliases: [], kind: "BANK", country: "IN", colors: ["#8B1C41", "#4C102A"], domain: "indusind.com" },
  { id: "yes-bank", name: "YES Bank", shortName: "YES", aliases: [], kind: "BANK", country: "IN", colors: ["#0054A6", "#ED1C24"], domain: "yesbank.in" },
  { id: "idfc-first", name: "IDFC FIRST Bank", shortName: "IDFC", aliases: ["idfc"], kind: "BANK", country: "IN", colors: ["#9D1D27", "#6C1118"], domain: "idfcfirstbank.com" },
  { id: "federal", name: "Federal Bank", shortName: "FED", aliases: [], kind: "BANK", country: "IN", colors: ["#F9A01B", "#1D3F6E"], domain: "federalbank.co.in" },
  { id: "rbl", name: "RBL Bank", shortName: "RBL", aliases: ["ratnakar"], kind: "BANK", country: "IN", colors: ["#E2231A", "#8A0F0A"], domain: "rblbank.com" },
  { id: "bandhan", name: "Bandhan Bank", shortName: "BANDHAN", aliases: [], kind: "BANK", country: "IN", colors: ["#E4002B", "#8A0019"], domain: "bandhanbank.com" },
  { id: "au-small-finance", name: "AU Small Finance Bank", shortName: "AU", aliases: [], kind: "BANK", country: "IN", colors: ["#F58220", "#5B2A82"], domain: "aubank.in" },
  // Indian wallets / payments banks
  { id: "jio-payments", name: "Jio Payments Bank", shortName: "JIO", aliases: ["jio payments"], kind: "WALLET", country: "IN", colors: ["#0F3CC9", "#081E72"], domain: "jiopaymentsbank.com" },
  { id: "airtel-payments", name: "Airtel Payments Bank", shortName: "AIRTEL", aliases: [], kind: "WALLET", country: "IN", colors: ["#ED1C24", "#A90F17"], domain: "airtel.in" },
  { id: "paytm-payments", name: "Paytm Payments Bank", shortName: "PAYTM", aliases: ["paytm"], kind: "WALLET", country: "IN", colors: ["#00BAF2", "#002E6E"], domain: "paytmbank.com" },
  // Brokers / investment platforms
  { id: "zerodha", name: "Zerodha", shortName: "ZERODHA", aliases: ["kite"], kind: "BROKER", country: "IN", colors: ["#387ED1", "#1B4F8A"], domain: "zerodha.com" },
  { id: "groww", name: "Groww", shortName: "GROWW", aliases: [], kind: "BROKER", country: "IN", colors: ["#00D09C", "#00B386"], domain: "groww.in" },
  { id: "indmoney", name: "INDmoney", shortName: "IND", aliases: ["ind money"], kind: "BROKER", country: "IN", colors: ["#5235E8", "#2E1C9E"], domain: "indmoney.com" },
  { id: "upstox", name: "Upstox", shortName: "UPSTOX", aliases: [], kind: "BROKER", country: "IN", colors: ["#5C2D91", "#3B1C5E"], domain: "upstox.com" },
  { id: "angelone", name: "Angel One", shortName: "ANGEL", aliases: ["angel broking"], kind: "BROKER", country: "IN", colors: ["#3D2BD6", "#2A1E96"], domain: "angelone.in" },
  { id: "dhan", name: "Dhan", shortName: "DHAN", aliases: [], kind: "BROKER", country: "IN", colors: ["#0F5FDC", "#0A3E92"], domain: "dhan.co" },
  { id: "icici-direct", name: "ICICI Direct", shortName: "IDIRECT", aliases: ["icicidirect"], kind: "BROKER", country: "IN", colors: ["#F58220", "#A51C30"], domain: "icicidirect.com" },
  { id: "hdfc-sky", name: "HDFC Sky", shortName: "SKY", aliases: [], kind: "BROKER", country: "IN", colors: ["#004C8F", "#E31E24"], domain: "hdfcsky.com" },
  { id: "kotak-neo", name: "Kotak Neo", shortName: "NEO", aliases: [], kind: "BROKER", country: "IN", colors: ["#ED1C24", "#123B72"], domain: "kotaksecurities.com" },
  { id: "motilal-oswal", name: "Motilal Oswal", shortName: "MOSL", aliases: ["motilal"], kind: "BROKER", country: "IN", colors: ["#F7A600", "#1B365D"], domain: "motilaloswal.com" },
  { id: "5paisa", name: "5paisa", shortName: "5PAISA", aliases: [], kind: "BROKER", country: "IN", colors: ["#0072BC", "#004E80"], domain: "5paisa.com" },
  { id: "alpaca", name: "Alpaca", shortName: "ALPACA", aliases: [], kind: "BROKER", country: "US", colors: ["#FCD34D", "#F59E0B"], domain: "alpaca.markets" },
  // Bullion vaults — digital gold, silver and platinum, held in grams
  { id: "tanishq", name: "Tanishq Digital Gold", shortName: "TANISHQ", aliases: ["tanishq", "titan"], kind: "BULLION", country: "IN", colors: ["#8B1A3A", "#C9A227"], domain: "tanishq.co.in" },
  { id: "safegold", name: "SafeGold", shortName: "SAFEGOLD", aliases: ["safe gold", "digital gold india"], kind: "BULLION", country: "IN", colors: ["#C9A227", "#7A5C00"], domain: "safegold.com" },
  { id: "augmont", name: "Augmont", shortName: "AUGMONT", aliases: ["augmont gold"], kind: "BULLION", country: "IN", colors: ["#D4AF37", "#8A6D1F"], domain: "augmont.com" },
  { id: "mmtc-pamp", name: "MMTC-PAMP", shortName: "MMTC", aliases: ["mmtc", "pamp"], kind: "BULLION", country: "IN", colors: ["#B8860B", "#5C4405"], domain: "mmtcpamp.com" },
  { id: "phonepe-gold", name: "PhonePe Gold", shortName: "PHONEPE", aliases: ["phonepe"], kind: "BULLION", country: "IN", colors: ["#5F259F", "#3A1663"], domain: "phonepe.com" },
  { id: "paytm-gold", name: "Paytm Gold", shortName: "PAYTMGOLD", aliases: ["paytm gold"], kind: "BULLION", country: "IN", colors: ["#00BAF2", "#002E6E"], domain: "paytm.com" },
  { id: "jar", name: "Jar", shortName: "JAR", aliases: ["jar app"], kind: "BULLION", country: "IN", colors: ["#FFC93C", "#8A6A00"], domain: "myjar.app" },
  { id: "gullak", name: "Gullak", shortName: "GULLAK", aliases: [], kind: "BULLION", country: "IN", colors: ["#F4B400", "#7A5A00"], domain: "gullak.money" },
  // International banks
  { id: "hsbc", name: "HSBC", shortName: "HSBC", aliases: [], kind: "BANK", country: "GB", colors: ["#DB0011", "#9E000C"], domain: "hsbc.com" },
  { id: "standard-chartered", name: "Standard Chartered", shortName: "SC", aliases: ["stan chart"], kind: "BANK", country: "GB", colors: ["#00AEEF", "#2AAE61"], domain: "sc.com" },
  { id: "dbs", name: "DBS Bank", shortName: "DBS", aliases: ["digibank"], kind: "BANK", country: "SG", colors: ["#FF3621", "#A8190E"], domain: "dbs.com" },
  { id: "ubs", name: "UBS Switzerland", shortName: "UBS", aliases: ["swiss bank"], kind: "BANK", country: "CH", colors: ["#E60000", "#111827"], domain: "ubs.com" },
  { id: "credit-suisse", name: "Credit Suisse", shortName: "CS", aliases: [], kind: "BANK", country: "CH", colors: ["#003B70", "#0077B5"], domain: "credit-suisse.com" },
  { id: "deutsche", name: "Deutsche Bank", shortName: "DB", aliases: [], kind: "BANK", country: "DE", colors: ["#0018A8", "#003DA5"], domain: "db.com" },
  { id: "citi", name: "Citibank", shortName: "CITI", aliases: ["citi bank"], kind: "BANK", country: "US", colors: ["#056DAE", "#E31837"], domain: "citi.com" },
  { id: "jpmorgan", name: "JPMorgan Chase", shortName: "CHASE", aliases: ["chase"], kind: "BANK", country: "US", colors: ["#0B5CAD", "#163B65"], domain: "chase.com" },
  { id: "bank-of-america", name: "Bank of America", shortName: "BOA", aliases: [], kind: "BANK", country: "US", colors: ["#E31837", "#0052A5"], domain: "bankofamerica.com" },
  { id: "wells-fargo", name: "Wells Fargo", shortName: "WF", aliases: [], kind: "BANK", country: "US", colors: ["#D71E28", "#B01C24"], domain: "wellsfargo.com" },
  // Retirement / savings schemes (no logo — use the badge)
  { id: "ppf", name: "Public Provident Fund", shortName: "PPF", aliases: [], kind: "SAVINGS", country: "IN", colors: ["#F59E0B", "#B45309"] },
  { id: "nps", name: "National Pension System", shortName: "NPS", aliases: ["national pension"], kind: "RETIREMENT", country: "IN", colors: ["#2563EB", "#1D4ED8"] },
  { id: "epfo", name: "Employees' Provident Fund", shortName: "EPFO", aliases: ["epf", "provident fund"], kind: "RETIREMENT", country: "IN", colors: ["#059669", "#047857"] },
];

export function findFinancialProvider(value?: string | null) {
  const needle = value?.trim().toLowerCase();
  if (!needle) return undefined;
  return FINANCIAL_PROVIDERS.find((provider) =>
    provider.id === needle || provider.name.toLowerCase() === needle ||
    provider.shortName.toLowerCase() === needle || provider.aliases.some((alias) => needle.includes(alias)),
  ) ?? FINANCIAL_PROVIDERS.find((provider) => needle.includes(provider.shortName.toLowerCase()));
}
