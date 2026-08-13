import { logger } from "../lib/logger";
import { aiContextService } from "./ai-context-service";

// ── Real Anthropic API wiring ─────────────────────────────────────────────────
// Uses the existing aiContextService/aiContextBuilder to turn structured facts
// into a text context block (no separate ad-hoc context building here), then
// sends that plus a task-specific instruction to Claude via a real HTTP call.
// No client-side fabrication: if the API key is missing or the call fails,
// callers get an explicit "unavailable"/"error" status, never invented prose.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
// Haiku-class model — these are short, structured write-ups built entirely
// from facts already computed server-side, not open-ended multi-step
// reasoning, so they don't need Sonnet-tier capability. This is the single
// biggest per-call cost lever available (Haiku is roughly 1/15th of Sonnet's
// per-token price), independent of how often the model is actually called.
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Real model calls cost money — cache write-ups instead of regenerating on
// every poll. Both dashboard boxes poll their route every 60s
// (TopBreakoutCandidates.tsx / OptionsSetupsToWatch.tsx), and each request
// re-derives the top-10/top-5 candidate lists from live scores, so a stock
// bouncing in and out of the list across polls used to mean a fresh model
// call every time it reappeared after 30 min. Against a ~150-ticker universe
// with prices moving all day, that produced far more distinct (ticker,
// re-entry) pairs than the "~15 stocks" the feature nominally covers —
// consistent with the 100+ calls/2 days actually observed.
//
// Fixed daily cadence, PLUS change-detection on the specific facts a
// write-up asserts directionally (see fingerprint below): a flat TTL alone
// let a write-up assert "trading below both its 50-day and 200-day average"
// while the live price shown right next to it had already moved above both
// — a real, user-visible contradiction (confirmed live on ONDS), not a
// hypothetical. Moving averages and the setup label don't change every
// poll, so gating regeneration on them changing, in addition to the 24h
// ceiling, doesn't reintroduce the original cost problem (100+ calls/2 days
// for ~15 stocks) — it only forces a refresh exactly when the narrative the
// write-up commits to (above/below a level) would otherwise go stale-wrong
// instead of just stale-vague.
const WRITEUP_TTL_MS = 24 * 60 * 60 * 1000;
// If a call fails, retry sooner than a full success TTL rather than serving
// the same error for a full day.
const ERROR_RETRY_MS = 3 * 60 * 1000;

interface CachedWriteup { text: string; ts: number; isError: boolean; fingerprint: string }

// Captures the facts most likely to make cached prose read as factually
// wrong if they drift, rather than just slightly dated — specifically,
// which side of its own moving averages the price sits on, and the
// screener's own directional read. Compared against the fingerprint at
// generation time; a mismatch forces a regenerate regardless of TTL.
function computeFingerprint(parts: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(parts).map(([k, v]) => `${k}=${v}`).join("|");
}

function maPosition(price: number | undefined, ma: number | undefined): "above" | "below" | undefined {
  if (price === undefined || ma === undefined) return undefined;
  return price >= ma ? "above" : "below";
}

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
  // These write-ups render as plain inline paragraphs in the UI, not through
  // a markdown renderer — a real bug this fixes: write-ups were coming back
  // with #/##/** markdown syntax and displaying those characters literally
  // on screen (e.g. "# AAOI Breakout Setup Analysis"). Write plain prose.
  "Write in plain prose only — no markdown syntax of any kind: no # or ## headers, no ** for bold, no bullet dashes or numbered-list markers, no backticks. This text is displayed as plain paragraphs, not rendered through a markdown parser, so any markdown characters you write will show up literally on screen as stray symbols. Use plain sentences and paragraph breaks only.",
  "Write using ONLY the facts given. Do not invent price targets, specific news events, analyst quotes, or catalysts you were not told about.",
  "If something relevant isn't in the facts (e.g. a specific news catalyst), say plainly that it's not known rather than guessing or fabricating one.",
  "Before writing, actively look through the given facts for anything that CUTS AGAINST the setup, not just what supports it — e.g. momentum facts look strong but volume is light for the size of the move, quality/accumulation primitives are solid but valuation is stretched relative to peers, price is extended above a moving average, or RSI is near an overbought/oversold extreme.",
  "If you find a genuine contradiction like that in the data, state it plainly in the write-up as a real caveat, in the same factual tone as the rest of the analysis — do not soften it into vague hedging.",
  "Do not fabricate a caveat if the data doesn't actually support one — if everything given genuinely lines up, it's fine and expected for the write-up to say so instead of manufacturing a fake concern.",
  "Never promise or imply guaranteed returns. This is not financial advice and should read that way.",
].join(" ");

async function generate(key: string, fingerprint: string, buildPrompt: () => Promise<string>): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const userPrompt = await buildPrompt();
    const text = await callAnthropic(SYSTEM_PROMPT, userPrompt);
    cache.set(key, { text, ts: Date.now(), isError: false, fingerprint });
  } catch (err) {
    logger.warn({ key, err }, "AI write-up generation failed");
    cache.set(key, {
      text: "AI analysis temporarily unavailable — the model call failed. Retrying on the next request.",
      ts: Date.now(),
      isError: true,
      fingerprint,
    });
  } finally {
    inFlight.delete(key);
  }
}

function getOrTrigger(key: string, fingerprint: string, buildPrompt: () => Promise<string>): WriteupResult {
  if (!isAnthropicConfigured()) {
    return { status: "unavailable", text: "AI analysis unavailable — ANTHROPIC_API_KEY is not configured on the server." };
  }

  const cached = cache.get(key);
  const ttl = cached?.isError ? ERROR_RETRY_MS : WRITEUP_TTL_MS;
  const fingerprintChanged = cached !== undefined && cached.fingerprint !== fingerprint;
  if (cached && !fingerprintChanged && Date.now() - cached.ts < ttl) {
    return { status: cached.isError ? "error" : "ready", text: cached.text };
  }

  void generate(key, fingerprint, buildPrompt);
  // Stale-while-revalidate: serve the last good text (if any) while a fresh
  // one generates in the background, instead of blocking the request on a
  // multi-second model call. A fingerprint change still serves the old text
  // for this one request rather than blocking — same trade-off as TTL
  // expiry, just triggered by a different condition.
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
    const fingerprint = computeFingerprint({
      reasonLabel: facts.reasonLabel,
      aboveMa50: maPosition(facts.price, facts.ma50),
      aboveMa200: maPosition(facts.price, facts.ma200),
    });
    return getOrTrigger(`breakout:${ticker}`, fingerprint, async () => {
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
        `- This screener's composite signal score for the stock right now: ${facts.breakoutReadiness}/100 (the same score used everywhere else in this screener — not a market-standard metric, and not a separate breakout-specific formula; this stock is on this list because that score is high AND the stock isn't currently flagged extended or quality-gated)`,
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
    const fingerprint = computeFingerprint({
      direction: facts.direction,
      aboveMa50: maPosition(facts.price, facts.ma50),
      aboveMa200: maPosition(facts.price, facts.ma200),
    });
    return getOrTrigger(`options:${ticker}`, fingerprint, async () => {
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
