import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiKeyMiddleware } from "./middlewares/apiKey.js";
import { generalLimiter } from "./middlewares/rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_ORIGINS = [
  /^https:\/\/geassbeam\.replit\.app$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.replit\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^https:\/\/infinitysearch\.pro$/,
  /^https:\/\/www\.infinitysearch\.pro$/,
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
}

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());

app.use(
  cors({
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) cb(null, true);
      else cb(new Error("CORS: origem não permitida"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-Panel-Secret"],
  }),
);

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

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.text({ type: ["text/plain", "text/csv"], limit: "2mb" }));

app.use(generalLimiter);
app.use(apiKeyMiddleware);

// Serve static assets (logo, banners) publicly — no auth required
// __dirname in compiled code = artifacts/api-server/dist/ → ../public resolves correctly
app.use("/api/static", express.static(path.join(__dirname, "../public"), {
  maxAge: "7d",
  etag: true,
}));

app.use("/api", router);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { status?: number; statusCode?: number }).statusCode
    ?? 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ error: message });
});

export default app;
