import { logger } from "../lib/logger";
import { aiContextService } from "./ai-context-service";

// ── Real Anthropic API wiring ─────────────────────────────────────────────────
// Uses the existing aiContextService/aiContextBuilder to turn structured facts
// into a text context block (no separate ad-hoc context building here), then
// sends that plus a task-specific instruction to Claude via a real HTTP call.
// No client-side fabrication: if the API key is missing or the call fails,
// callers get an explicit "unavailable"/"error" status, never invented prose.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Real model calls cost money and take a few seconds — cache write-ups instead
// of regenerating on every poll. 30 min matches the same order of magnitude as
// the other slow-moving inputs here (candles refresh every 6h, so a breakout
// candidate's underlying drivers don't change fast enough to justify calling
// the model more often than this).
const WRITEUP_TTL_MS = 30 * 60 * 1000;
// If a call fails, retry sooner than a full success TTL rather than serving
// the same error for 30 minutes.
const ERROR_RETRY_MS = 3 * 60 * 1000;

interface CachedWriteup { text: string; ts: number; isError: boolean }

const cache = new Map<string, CachedWriteup>();
const inFlight = new Set<string>();

export type WriteupStatus = "ready" | "generating" | "unavailable" | "error";
export interface WriteupResult { status: WriteupStatus; text: string | null }

function isAnthropicConfigured(): boolean {
  return ANTHROPIC_API_KEY.trim() !== "";
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Anthropic API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find(block => block.type === "text")?.text;
  if (!text || !text.trim()) throw new Error("Anthropic API returned no text content");
  return text.trim();
}

const SYSTEM_PROMPT = [
  "You are a markets analyst assistant embedded in a stock screener.",
  "You are given STRUCTURED, machine-computed facts about one ticker — not news, not your own general knowledge of the company.",
  "Write using ONLY the facts given. Do not invent price targets, specific news events, analyst quotes, or catalysts you were not told about.",
  "If something relevant isn't in the facts (e.g. a specific news catalyst), say plainly that it's not known rather than guessing or fabricating one.",
  "Never promise or imply guaranteed returns. This is not financial advice and should read that way.",
].join(" ");

async function generate(key: string, buildPrompt: () => Promise<string>): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const userPrompt = await buildPrompt();
    const text = await callAnthropic(SYSTEM_PROMPT, userPrompt);
    cache.set(key, { text, ts: Date.now(), isError: false });
  } catch (err) {
    logger.warn({ key, err }, "AI write-up generation failed");
    cache.set(key, {
      text: "AI analysis temporarily unavailable — the model call failed. Retrying on the next request.",
      ts: Date.now(),
      isError: true,
    });
  } finally {
    inFlight.delete(key);
  }
}

function getOrTrigger(key: string, buildPrompt: () => Promise<string>): WriteupResult {
  if (!isAnthropicConfigured()) {
    return { status: "unavailable", text: "AI analysis unavailable — ANTHROPIC_API_KEY is not configured on the server." };
  }

  const cached = cache.get(key);
  const ttl = cached?.isError ? ERROR_RETRY_MS : WRITEUP_TTL_MS;
  if (cached && Date.now() - cached.ts < ttl) {
    return { status: cached.isError ? "error" : "ready", text: cached.text };
  }

  void generate(key, buildPrompt);
  // Stale-while-revalidate: serve the last good text (if any) while a fresh
  // one generates in the background, instead of blocking the request on a
  // multi-second model call.
  return { status: "generating", text: cached && !cached.isError ? cached.text : null };
}

export const aiWriteupService = {
  getBreakoutWriteup(
    ticker: string,
    facts: {
      breakoutReadiness: number; ins: number; acs: number; vqs: number; lqs?: number; rsi?: number; fbrs: number;
      reasonLabel: string;
      price?: number; high52?: number; low52?: number; ma50?: number; ma200?: number;
    },
  ): WriteupResult {
    return getOrTrigger(`breakout:${ticker}`, async () => {
      const packet = aiContextService.buildTickerSignalPacket(
        ticker,
        "Explain why this stock is currently a breakout candidate",
      );
      const structuredContext = await aiContextService.render(packet);
      const priceLevelLines: string[] = [];
      if (facts.price !== undefined) priceLevelLines.push(`- Current price: $${facts.price.toFixed(2)}`);
      if (facts.high52 !== undefined) priceLevelLines.push(`- 52-week high: $${facts.high52.toFixed(2)}`);
      if (facts.low52 !== undefined) priceLevelLines.push(`- 52-week low: $${facts.low52.toFixed(2)}`);
      if (facts.ma50 !== undefined) priceLevelLines.push(`- 50-day moving average: $${facts.ma50.toFixed(2)}`);
      if (facts.ma200 !== undefined) priceLevelLines.push(`- 200-day moving average: $${facts.ma200.toFixed(2)}`);
      return [
        structuredContext,
        "",
        "Additional computed facts for this specific analysis:",
        `- Breakout Readiness score: ${facts.breakoutReadiness}/100 (this screener's own composite of momentum, accumulation, and room-to-run — not a market-standard metric)`,
        `- INS (inflection/momentum signal): ${facts.ins}`,
        `- ACS (accumulation confidence): ${facts.acs}`,
        `- VQS (valuation/quality): ${facts.vqs}${facts.lqs !== undefined ? `, LQS (long-term quality): ${facts.lqs}` : ""}`,
        facts.rsi !== undefined ? `- RSI(14): ${facts.rsi}` : "- RSI(14): not available yet",
        `- FBRS (false-breakout/hype risk, lower is cleaner): ${facts.fbrs}`,
        `- This screener's own label for the setup: "${facts.reasonLabel}"`,
        ...priceLevelLines,
        "",
        `Write a 3-4 sentence breakout-setup analysis for ${ticker}. Cover: (1) why this looks like a good setup given the specific numbers above, (2) concretely what to watch for it to actually play out — reference the ACTUAL 52-week high/low and moving-average price levels given above (e.g. "room to run toward the 52-week high of $X" or "needs to hold above the $Y 50-day average"), plus volume confirmation, (3) what would invalidate the setup (e.g. INS or ACS rolling over, RSI running into overbought, price falling back below a moving average level given above). Do not use vague trend-classification language ("uptrend", "breakout in progress", etc.) — cite the specific dollar levels instead. If a price level fact isn't given above, say plainly it isn't available rather than guessing one. If an earnings date or catalyst isn't in the facts above, say explicitly that none is known rather than guessing one.`,
      ].join("\n");
    });
  },

  getOptionsWriteup(
    ticker: string,
    facts: {
      direction: string;
      optionsSetupScore: number;
      realizedVolatility20d: number;
      rsi: number;
      acs: number;
      nextEarnings: { date: string; daysAway: number } | null;
      price?: number; high52?: number; low52?: number; ma50?: number; ma200?: number;
    },
  ): WriteupResult {
    return getOrTrigger(`options:${ticker}`, async () => {
      const packet = aiContextService.buildOptionsReasoningPacket(
        ticker,
        "Explain this options setup from real volatility and calendar data",
      );
      const structuredContext = await aiContextService.render(packet);
      const priceLevelLines: string[] = [];
      if (facts.price !== undefined) priceLevelLines.push(`- Current price: $${facts.price.toFixed(2)}`);
      if (facts.high52 !== undefined) priceLevelLines.push(`- 52-week high: $${facts.high52.toFixed(2)}`);
      if (facts.low52 !== undefined) priceLevelLines.push(`- 52-week low: $${facts.low52.toFixed(2)}`);
      if (facts.ma50 !== undefined) priceLevelLines.push(`- 50-day moving average: $${facts.ma50.toFixed(2)}`);
      if (facts.ma200 !== undefined) priceLevelLines.push(`- 200-day moving average: $${facts.ma200.toFixed(2)}`);
      return [
        structuredContext,
        "",
        "Additional computed facts for this specific analysis (these ARE real, not placeholders — options-chain data like IV/Greeks is still not connected, but the following are computed directly from live price history and a real earnings calendar):",
        `- Directional read: ${facts.direction}`,
        `- 20-day realized volatility (annualized): ${facts.realizedVolatility20d}%`,
        `- RSI(14): ${facts.rsi}`,
        `- ACS (accumulation confidence): ${facts.acs}`,
        facts.nextEarnings
          ? `- Next earnings date: ${facts.nextEarnings.date} (${facts.nextEarnings.daysAway} days away) — real date from the earnings calendar`
          : "- No earnings date in the next 10 days — this setup is based on realized volatility alone",
        `- Options Setup Score: ${facts.optionsSetupScore} (this screener's own composite of realized volatility and earnings proximity — not a market IV rank)`,
        ...priceLevelLines,
        "",
        `Write a 3-4 sentence analysis of ${ticker} as a ${facts.direction.toLowerCase()}. Cover: (1) the reasoning from the volatility/RSI/earnings facts above — reference the ACTUAL 52-week high/low and moving-average price levels given above where relevant (e.g. "already extended above the 200-day average of $X" or "sitting near the 52-week low of $Y"), not vague trend language, (2) what would confirm the thesis, (3) what would invalidate it, (4) roughly what timeframe this setup is relevant for (e.g. into the earnings date, or a multi-week technical window). If a price level fact isn't given above, say plainly it isn't available rather than guessing one. Do not state or imply specific option strikes, premiums, IV, or Greeks — that data isn't available here.`,
      ].join("\n");
    });
  },
};
