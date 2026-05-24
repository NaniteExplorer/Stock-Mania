import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDateRange(daysBack: number) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - daysBack);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function validateArticle(
  article: RawNewsArticle | null | undefined,
): article is RawNewsArticle {
  return Boolean(
    article?.headline?.trim() &&
      article.url?.trim() &&
      typeof article.datetime === "number",
  );
}

export function formatArticle(
  article: RawNewsArticle,
  isCompanyNews = false,
  symbol?: string,
  fallbackIndex = 0,
): MarketNewsArticle {
  return {
    id: article.id || fallbackIndex,
    headline: article.headline?.trim() || "Market update",
    summary: article.summary?.trim() || "",
    source: article.source?.trim() || "Finnhub",
    url: article.url?.trim() || "",
    datetime: article.datetime || 0,
    category: article.category?.trim() || (isCompanyNews ? "company" : "general"),
    related: article.related?.trim() || symbol || "",
    image: article.image?.trim() || undefined,
  };
}
