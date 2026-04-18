import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(__dirname, "dist/index.mjs"),
  sourcemap: true,
  external: [
    "node:*",
    "telegraf",
    "eventsource",
    "node-fetch",
  ],
  define: {
    "import.meta.dirname": JSON.stringify(__dirname),
  },
}).catch(() => process.exit(1));

console.log("✅ Telegram bot built.");
