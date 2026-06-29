/**
 * Reusable, server-only Gemini client.
 *
 * The Inngest functions (news, signals) use Inngest's managed `step.ai.infer`
 * for observability/retries. This is a plain REST client for synchronous,
 * outside-Inngest call sites (e.g. parsing an uploaded statement during a
 * Server Action). Both share the same GEMINI_API_KEY.
 *
 * SCALE: single choke point for direct Gemini calls — add response caching,
 * token accounting, or a provider swap here without touching call sites.
 */
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiUnavailableError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured.");
    this.name = "GeminiUnavailableError";
  }
}

interface GenerateOptions {
  model?: string;
  /** 0 = deterministic. Statement parsing/categorization want low temperature. */
  temperature?: number;
  signal?: AbortSignal;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export interface GeminiClient {
  isConfigured(): boolean;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  /** Generate and parse strict JSON. Throws if the model returns unparseable output. */
  generateJson<T>(prompt: string, options?: GenerateOptions): Promise<T>;
}

/** Strip ```json fences / prose the model sometimes wraps JSON in. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const firstBrace = candidate.search(/[[{]/);
  if (firstBrace < 0) return candidate;
  const lastBrace = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  return lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
}

class RestGeminiClient implements GeminiClient {
  isConfigured(): boolean {
    return Boolean(config.ai().geminiApiKey);
  }

  async generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const apiKey = config.ai().geminiApiKey;
    if (!apiKey) throw new GeminiUnavailableError();

    const model = options.model ?? DEFAULT_MODEL;
    const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: options.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: options.temperature ?? 0 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("Gemini request failed", undefined, { status: res.status, body: body.slice(0, 300) });
      throw new Error(`Gemini request failed (${res.status}).`);
    }

    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("Gemini returned an empty response.");
    return text;
  }

  async generateJson<T>(prompt: string, options: GenerateOptions = {}): Promise<T> {
    const text = await this.generateText(prompt, options);
    try {
      return JSON.parse(extractJson(text)) as T;
    } catch (err) {
      logger.error("Gemini JSON parse failed", err, { sample: text.slice(0, 300) });
      throw new Error("Gemini returned malformed JSON.");
    }
  }
}

export const geminiClient: GeminiClient = new RestGeminiClient();
