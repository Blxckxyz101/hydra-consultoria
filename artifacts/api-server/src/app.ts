import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiKeyMiddleware } from "./middlewares/apiKey.js";
import { generalLimiter } from "./middlewares/rateLimit.js";

const ALLOWED_ORIGINS = [
  /^https:\/\/geassbeam\.replit\.app$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.replit\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
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

app.use("/api", router);

export default app;
