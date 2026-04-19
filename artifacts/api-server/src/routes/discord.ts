import { Router, type IRouter } from "express";

const router: IRouter = Router();

const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN ?? "";
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? "1493775313749151754";
const DISCORD_API    = "https://discord.com/api/v10";

function botHeaders() {
  return {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

router.get("/discord/guilds", async (_req, res) => {
  try {
    if (!BOT_TOKEN) {
      res.status(503).json({ error: "DISCORD_BOT_TOKEN not configured" });
      return;
    }
    const r = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers: botHeaders() });
    if (!r.ok) {
      res.status(r.status).json({ error: `Discord API error: ${r.status}` });
      return;
    }
    const guilds = await r.json() as Array<{
      id: string; name: string; icon: string | null; owner: boolean; permissions: string;
    }>;
    const result = guilds.map(g => ({
      id:          g.id,
      name:        g.name,
      icon:        g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
        : null,
      memberCount: null,
    }));
    res.json({ guilds: result, applicationId: APPLICATION_ID });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/discord/guilds/:id", async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      res.status(503).json({ error: "DISCORD_BOT_TOKEN not configured" });
      return;
    }
    const { id } = req.params;
    const r = await fetch(`${DISCORD_API}/users/@me/guilds/${id}`, {
      method: "DELETE",
      headers: botHeaders(),
    });
    if (r.status === 204 || r.status === 200) {
      res.json({ ok: true });
      return;
    }
    const body = await r.text();
    res.status(r.status).json({ error: `Discord API error: ${r.status}`, detail: body });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/discord/invite-link", (_req, res) => {
  const permissions = "8";
  const scope       = "bot%20applications.commands";
  const url = `https://discord.com/oauth2/authorize?client_id=${APPLICATION_ID}&permissions=${permissions}&scope=${scope}`;
  res.json({ url, applicationId: APPLICATION_ID });
});

export default router;
