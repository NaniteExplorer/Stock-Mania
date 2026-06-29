import { inngest } from "@/lib/inngest/client";
import { NEWS_SUMMARY_EMAIL_PROMPT } from "@/lib/inngest/prompts";
import { sendNewsSummaryEmail } from "@/lib/nodemailer";
import { getAllUsersForNewsEmail } from "@/features/user/user.service";
import { getWatchListSymbolsByEmail } from "@/features/watchlist/watchlist.actions";
import { getNews } from "@/features/news/news.service";
import { getFormattedTodayDate } from "@/lib/utils";
import { alertService } from "@/features/alerts/alert.service";
import { signalService, buildSignalPrompt, parseSignalResponse } from "@/features/signals/signal.service";
import { aiCategorizeAccount } from "@/features/transactions/ai-categorizer.service";
import { config } from "@/core/config/env";

type UserForNewsEmail = {
  id: string;
  email: string;
  name: string;
};

/**
 * Dispatcher — runs on a cron. Fans out one durable event per user.
 */
export const sendDailyNewsSummary = inngest.createFunction(
  {
    id: "daily-news-dispatch",
    triggers: [{ event: "app/send.daily.news" }, { cron: "0 12 * * *" }],
  },
  async ({ step }) => {
    const users = await step.run("get-all-users", getAllUsersForNewsEmail);

    if (!users || users.length === 0) {
      return { success: false, message: "No users found for news email" };
    }

    const date = await step.run("resolve-date", async () =>
      getFormattedTodayDate(),
    );

    const events = (users as UserForNewsEmail[])
      .filter((u) => u.email)
      .map((u) => ({
        name: "app/news.user.requested",
        id: `news-${u.id || u.email}-${date}`,
        data: { id: u.id, email: u.email, name: u.name, date },
      }));

    await step.sendEvent("fan-out-user-news", events);

    return { success: true, dispatched: events.length };
  },
);

/**
 * Worker — builds and sends ONE user's news summary.
 */
export const sendUserNewsSummary = inngest.createFunction(
  {
    id: "user-news-summary",
    triggers: { event: "app/news.user.requested" },
    concurrency: { limit: 10 },
    throttle: { limit: 30, period: "1m" },
    retries: 3,
  },
  async ({ event, step }) => {
    const { email, date } = event.data as { email: string; date: string };

    const articles = await step.run("fetch-news", async () => {
      const symbols = await getWatchListSymbolsByEmail(email);
      let items = (await getNews(symbols))?.slice(0, 6) ?? [];
      if (items.length === 0) items = (await getNews())?.slice(0, 6) ?? [];
      return items;
    });

    if (!articles || articles.length === 0) {
      return { success: false, email, reason: "no-news" };
    }

    const response = await step.ai.infer("summarize-news", {
      model: step.ai.models.gemini({ model: "gemini-2.5-flash-lite" }),
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: NEWS_SUMMARY_EMAIL_PROMPT.replace(
                  "{{newsData}}",
                  JSON.stringify(articles, null, 2),
                ),
              },
            ],
          },
        ],
      },
    });

    await step.run("send-news-email", async () => {
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const newsContent =
        (part && "text" in part ? part.text : null) || "No market news.";
      return sendNewsSummaryEmail({ email, date, newsContent });
    });

    return { success: true, email };
  },
);

/**
 * Price alert checker — runs every 5 minutes during market hours.
 * Fetches current prices for all active alerts and notifies users if triggered.
 */
export const checkPriceAlerts = inngest.createFunction(
  {
    id: "check-price-alerts",
    triggers: [
      { event: "app/alerts.check" },
      { cron: "*/5 9-16 * * 1-5" }, // Every 5 min, Mon–Fri 9am–4pm UTC
    ],
    retries: 1,
  },
  async ({ step }) => {
    const result = await step.run("check-and-notify", () =>
      alertService.checkAndNotify(),
    );
    return result;
  },
);

/**
 * AI trading signal generator.
 * Triggered manually (app/signal.requested) or by a scheduled cron for watchlist symbols.
 */
export const generateAISignal = inngest.createFunction(
  {
    id: "generate-ai-signal",
    triggers: [{ event: "app/signal.requested" }],
    concurrency: { limit: 5 },
    throttle: { limit: 20, period: "1m" },
    retries: 2,
  },
  async ({ event, step }) => {
    const { symbol } = event.data as { symbol: string };

    const priceData = await step.run("fetch-price", async () => {
      const { apiKey, baseUrl } = config.finnhub();
      if (!apiKey) return null;
      const res = await fetch(
        `${baseUrl}/quote?symbol=${symbol}&token=${apiKey}`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      return res.json() as Promise<{ c: number }>;
    });

    if (!priceData?.c) {
      return { success: false, reason: "price-unavailable", symbol };
    }

    const news = await step.run("fetch-news", async () => {
      const articles = await getNews([symbol]);
      return articles?.slice(0, 5).map((a) => a.headline ?? "") ?? [];
    });

    const prompt = buildSignalPrompt({
      symbol,
      currentPrice: priceData.c,
      newsHeadlines: news as string[],
    });

    const response = await step.ai.infer("generate-signal", {
      model: step.ai.models.gemini({ model: "gemini-2.5-flash-lite" }),
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      },
    });

    const saved = await step.run("save-signal", async () => {
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const raw = part && "text" in part ? part.text : null;
      if (!raw) return null;

      const parsed = parseSignalResponse(raw);
      if (!parsed) return null;

      return signalService.save(
        { symbol, currentPrice: priceData.c, newsHeadlines: news as string[] },
        parsed,
      );
    });

    return { success: true, symbol, signalId: saved?.id ?? null };
  },
);

/**
 * Categorizes freshly-imported transactions the rules engine couldn't classify,
 * using Gemini. Fires after a statement import (app/transactions.imported).
 */
export const categorizeImportedTransactions = inngest.createFunction(
  {
    id: "categorize-imported-transactions",
    triggers: [{ event: "app/transactions.imported" }],
    concurrency: { limit: 5 },
    throttle: { limit: 20, period: "1m" },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, accountId } = event.data as { userId: string; accountId: string };
    if (!userId || !accountId) return { success: false, reason: "missing-ids" };

    const result = await step.run("ai-categorize", () =>
      aiCategorizeAccount(userId, accountId),
    );

    return { success: true, ...result };
  },
);

/**
 * Daily signal generation for popular symbols — runs at market open.
 */
export const generateDailySignals = inngest.createFunction(
  {
    id: "daily-signals-dispatch",
    triggers: [{ event: "app/signals.daily" }, { cron: "30 9 * * 1-5" }],
  },
  async ({ step }) => {
    const SYMBOLS = ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA", "RELIANCE", "TCS", "INFY"];

    const events = SYMBOLS.map((symbol) => ({
      name: "app/signal.requested",
      data: { symbol, requestedBy: "system" },
    }));

    await step.sendEvent("dispatch-signals", events);

    return { dispatched: events.length };
  },
);
