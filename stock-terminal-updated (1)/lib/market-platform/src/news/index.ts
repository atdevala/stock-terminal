import type { InstrumentId } from "../core";

export interface NewsItem {
  id: string;
  ts: number;
  headline: string;
  source: string;
  url?: string;
  instruments?: InstrumentId[];
  summary?: string;
  sentiment?: "positive" | "negative" | "neutral";
}
