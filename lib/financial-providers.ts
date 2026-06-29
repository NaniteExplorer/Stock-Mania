export type ProviderKind = "BANK" | "RETIREMENT" | "SAVINGS" | "WALLET";

export interface FinancialProvider {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  kind: ProviderKind;
  country: string;
  colors: [string, string];
}

export const FINANCIAL_PROVIDERS: FinancialProvider[] = [
  { id: "sbi", name: "State Bank of India", shortName: "SBI", aliases: ["state bank"], kind: "BANK", country: "IN", colors: ["#00A6E2", "#0867A9"] },
  { id: "hdfc", name: "HDFC Bank", shortName: "HDFC", aliases: ["housing development finance"], kind: "BANK", country: "IN", colors: ["#E31E24", "#004C8F"] },
  { id: "axis", name: "Axis Bank", shortName: "AXIS", aliases: ["uti bank"], kind: "BANK", country: "IN", colors: ["#97144D", "#5E1236"] },
  { id: "jio-payments", name: "Jio Payments Bank", shortName: "JIO", aliases: ["jio payments"], kind: "WALLET", country: "IN", colors: ["#0F3CC9", "#081E72"] },
  { id: "kotak", name: "Kotak Mahindra Bank", shortName: "KOTAK", aliases: ["kotak 811"], kind: "BANK", country: "IN", colors: ["#ED1C24", "#123B72"] },
  { id: "icici", name: "ICICI Bank", shortName: "ICICI", aliases: [], kind: "BANK", country: "IN", colors: ["#F58220", "#A51C30"] },
  { id: "bob", name: "Bank of Baroda", shortName: "BOB", aliases: ["baroda"], kind: "BANK", country: "IN", colors: ["#F26522", "#E64618"] },
  { id: "pnb", name: "Punjab National Bank", shortName: "PNB", aliases: [], kind: "BANK", country: "IN", colors: ["#A20B35", "#F5A623"] },
  { id: "canara", name: "Canara Bank", shortName: "CANARA", aliases: [], kind: "BANK", country: "IN", colors: ["#00AEEF", "#FFC20E"] },
  { id: "union-bank", name: "Union Bank of India", shortName: "UNION", aliases: [], kind: "BANK", country: "IN", colors: ["#E31E24", "#00529B"] },
  { id: "indusind", name: "IndusInd Bank", shortName: "INDUS", aliases: [], kind: "BANK", country: "IN", colors: ["#8B1C41", "#4C102A"] },
  { id: "yes-bank", name: "YES Bank", shortName: "YES", aliases: [], kind: "BANK", country: "IN", colors: ["#0054A6", "#ED1C24"] },
  { id: "idfc-first", name: "IDFC FIRST Bank", shortName: "IDFC", aliases: ["idfc"], kind: "BANK", country: "IN", colors: ["#9D1D27", "#6C1118"] },
  { id: "au-small-finance", name: "AU Small Finance Bank", shortName: "AU", aliases: [], kind: "BANK", country: "IN", colors: ["#F58220", "#5B2A82"] },
  { id: "airtel-payments", name: "Airtel Payments Bank", shortName: "AIRTEL", aliases: [], kind: "WALLET", country: "IN", colors: ["#ED1C24", "#A90F17"] },
  { id: "paytm-payments", name: "Paytm Payments Bank", shortName: "PAYTM", aliases: ["paytm"], kind: "WALLET", country: "IN", colors: ["#00BAF2", "#002E6E"] },
  { id: "hsbc", name: "HSBC", shortName: "HSBC", aliases: [], kind: "BANK", country: "GB", colors: ["#DB0011", "#9E000C"] },
  { id: "standard-chartered", name: "Standard Chartered", shortName: "SC", aliases: ["stan chart"], kind: "BANK", country: "GB", colors: ["#00AEEF", "#2AAE61"] },
  { id: "ubs", name: "UBS Switzerland", shortName: "UBS", aliases: ["swiss bank"], kind: "BANK", country: "CH", colors: ["#E60000", "#111827"] },
  { id: "credit-suisse", name: "Credit Suisse", shortName: "CS", aliases: [], kind: "BANK", country: "CH", colors: ["#003B70", "#0077B5"] },
  { id: "deutsche", name: "Deutsche Bank", shortName: "DB", aliases: [], kind: "BANK", country: "DE", colors: ["#0018A8", "#003DA5"] },
  { id: "citi", name: "Citibank", shortName: "CITI", aliases: ["citi bank"], kind: "BANK", country: "US", colors: ["#056DAE", "#E31837"] },
  { id: "jpmorgan", name: "JPMorgan Chase", shortName: "CHASE", aliases: ["chase"], kind: "BANK", country: "US", colors: ["#0B5CAD", "#163B65"] },
  { id: "bank-of-america", name: "Bank of America", shortName: "BOA", aliases: [], kind: "BANK", country: "US", colors: ["#E31837", "#0052A5"] },
  { id: "wells-fargo", name: "Wells Fargo", shortName: "WF", aliases: [], kind: "BANK", country: "US", colors: ["#D71E28", "#B01C24"] },
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
