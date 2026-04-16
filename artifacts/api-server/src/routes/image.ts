/**
 * IMAGE GENERATION — Lelouch Geass Vision
 *
 * POST /api/generate-image
 *   body: { prompt: string; style?: string; size?: "1024x1024" | "512x512" | "256x256" }
 *   returns: { b64_json: string; prompt: string; revisedPrompt?: string }
 *
 * Uses OpenAI gpt-image-1 via Replit AI Integrations proxy.
 * Prompt is enhanced with Lelouch Britannia thematic style.
 */
import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { imageLimiter } from "../middlewares/rateLimit.js";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

// gpt-image-1 supports: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait)
const VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
type ValidSize = typeof VALID_SIZES[number];

// Lelouch Britannia thematic style injected into every prompt
const LELOUCH_STYLE_SUFFIX = [
  "dark fantasy art style",
  "deep crimson and black color palette",
  "Code Geass anime aesthetic",
  "dramatic lighting with Geass eye glow effects",
  "intricate royal Britannian design language",
  "high detail digital art",
  "cinematic composition",
  "no watermarks, no text overlays",
].join(", ");

function enhancePrompt(userPrompt: string, style?: string): string {
  const base = userPrompt.trim();
  if (style === "realistic") {
    return `${base}, photorealistic, dramatic lighting, high detail, 8K resolution, no watermarks`;
  }
  if (style === "minimal") {
    return `${base}, minimalist design, clean lines, flat art, no watermarks`;
  }
  // Default: Lelouch/Code Geass theme
  return `${base}, ${LELOUCH_STYLE_SUFFIX}`;
}

router.post("/generate-image", imageLimiter, async (req, res) => {
  const { prompt, style, size } = req.body as { prompt?: string; style?: string; size?: string };

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
    res.status(400).json({ error: "A prompt is required (minimum 3 characters)." });
    return;
  }

  if (prompt.length > 2000) {
    res.status(400).json({ error: "Prompt must be under 2000 characters." });
    return;
  }

  const validatedSize: ValidSize = VALID_SIZES.includes(size as ValidSize)
    ? (size as ValidSize)
    : "1024x1024";

  const enhancedPrompt = enhancePrompt(prompt, style);

  try {
    const response = await openai.images.generate({
      model:   "gpt-image-1",
      prompt:  enhancedPrompt,
      size:    validatedSize,
      n:       1,
    });

    const imageData = response.data?.[0];
    if (!imageData?.b64_json) {
      res.status(502).json({ error: "Image generation returned no data." });
      return;
    }

    res.json({
      b64_json:       imageData.b64_json,
      prompt:         prompt.trim(),
      enhancedPrompt,
      revisedPrompt:  (imageData as { revised_prompt?: string }).revised_prompt ?? null,
      size:           validatedSize,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[IMAGE GEN ERROR]", msg);

    if (msg.includes("safety") || msg.includes("content_policy") || msg.includes("moderation")) {
      res.status(422).json({ error: "Prompt rejected by content policy. Try a different description." });
      return;
    }
    res.status(500).json({ error: `Image generation failed: ${msg.slice(0, 150)}` });
  }
});

export default router;
