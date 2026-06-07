import { inngest } from "@/lib/inngest/client";
import {
  NEWS_SUMMARY_EMAIL_PROMPT,
  PERSONALIZED_WELCOME_EMAIL_PROMPT,
} from "@/lib/inngest/prompts";
import { sendNewsSummaryEmail, sendWelcomeEmail } from "@/lib/nodemailer";
import { getAllUsersForNewsEmail } from "@/features/user/user.service";
import { getWatchListSymbolsByEmail } from "@/features/watchlist/watchlist.actions";
import { getNews } from "@/features/news/news.service";
import { getFormattedTodayDate } from "@/lib/utils";

type UserForNewsEmail = {
  id: string;
  email: string;
  name: string;
};

export const sendSignUpEmail = inngest.createFunction(
  { id: "sign-up-email", triggers: { event: "app/user.created" } },
  async ({ event, step }) => {
    const userProfile = `
            - Country: ${event.data.country}
            - Investment goals: ${event.data.investmentGoals}
            - Risk tolerance: ${event.data.riskTolerance}
            - Preferred industry: ${event.data.preferredIndustry}
        `;

    const prompt = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace(
      "{{userProfile}}",
      userProfile,
    );

    const response = await step.ai.infer("generate-welcome-intro", {
      model: step.ai.models.gemini({ model: "gemini-2.5-flash-lite" }),
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      },
    });

    await step.run("send-welcome-email", async () => {
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const introText =
        (part && "text" in part ? part.text : null) ||
        "Thanks for joining stockMania. You now have the tools to track markets and make smarter moves.";

      const {
        data: { email, name },
      } = event;

      return await sendWelcomeEmail({ email, name, intro: introText });
    });

    return { success: true, message: "Welcome email sent successfully" };
  },
);

/**
 * Dispatcher — runs on a cron (or manual event). It does almost no work: load
 * users and fan out ONE durable event per user. The heavy work (news + AI +
 * email) runs in isolated, independently-retried worker runs below, so a single
 * user's failure or a slow upstream never blocks the rest, and the whole job
 * never sits in one long-running step that can time out.
 *
 * SCALE: for very large user bases, page the user query and call step.sendEvent
 * per page rather than building one large array.
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
        // Idempotency: at most one summary per user per day, even if the cron retries.
        id: `news-${u.id || u.email}-${date}`,
        data: { id: u.id, email: u.email, name: u.name, date },
      }));

    await step.sendEvent("fan-out-user-news", events);

    return { success: true, dispatched: events.length };
  },
);

/**
 * Worker — builds and sends ONE user's news summary. `concurrency` and
 * `throttle` cap how hard we hit Finnhub / Gemini / SMTP; each step is retried
 * independently.
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
