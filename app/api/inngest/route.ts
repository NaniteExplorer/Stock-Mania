import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  sendDailyNewsSummary,
  sendSignUpEmail,
  sendUserNewsSummary,
  checkPriceAlerts,
  generateAISignal,
  generateDailySignals,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    sendSignUpEmail,
    sendDailyNewsSummary,
    sendUserNewsSummary,
    checkPriceAlerts,
    generateAISignal,
    generateDailySignals,
  ],
});
