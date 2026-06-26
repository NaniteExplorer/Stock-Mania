import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  sendDailyNewsSummary,
  sendUserNewsSummary,
  checkPriceAlerts,
  generateAISignal,
  generateDailySignals,
} from "@/lib/inngest/functions";

// Note: the welcome email is now sent directly from the sign-up action
// (lib/actions/auth.actions.ts) so it lands reliably without Inngest running.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    sendDailyNewsSummary,
    sendUserNewsSummary,
    checkPriceAlerts,
    generateAISignal,
    generateDailySignals,
  ],
});
