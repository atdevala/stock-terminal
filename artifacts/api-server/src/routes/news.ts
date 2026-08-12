import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getMovingStockNews, fetchCompanyNews } from "../lib/news";

// Separate, self-contained route for the template-based "why is this stock
// moving" news feed (see lib/news.ts) — deliberately isolated from
// stocks.ts's scoring/ranking routes, since this feature is unrelated to
// that work.

const router: IRouter = Router();

router.get("/news-blurbs", async (_req, res) => {
  try {
    const blurbs = await getMovingStockNews();
    res.json(blurbs);
  } catch (err) {
    logger.error({ err }, "/news-blurbs route failed");
    res.status(500).json({ error: "News blurb generation failed" });
  }
});

// TEMPORARY — debugging why /news-blurbs came back empty despite real
// movers. Shows the raw articles fetchCompanyNews got back for one ticker.
// Remove once verified.
router.get("/debug/news/:ticker", async (req, res) => {
  try {
    const articles = await fetchCompanyNews(req.params.ticker.toUpperCase());
    res.json({ ticker: req.params.ticker, count: articles.length, articles });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
