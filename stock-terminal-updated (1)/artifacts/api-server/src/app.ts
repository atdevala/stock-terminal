import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const dashboardDir = path.resolve(
    __dirname,
    "../../live-dashboard/dist/public",
  );
  const indexHtml = path.join(dashboardDir, "index.html");

  if (existsSync(indexHtml)) {
    app.use(express.static(dashboardDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
      res.sendFile(indexHtml, (err) => {
        if (err) next(err);
      });
    });
  } else {
    logger.warn(
      { dashboardDir },
      "Dashboard build output not found; serving API only",
    );
  }
}

// Global error handler — must be registered after all routes.
// Express detects this as an error handler via the 4-argument signature.
// In Express 5, async route errors are automatically forwarded here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message }, "Unhandled route error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
