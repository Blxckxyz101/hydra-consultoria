import { Router, type IRouter } from "express";
import { db, infinityUsersTable, infinityFriendshipsTable, infinityChatRoomsTable, infinityChatMessagesTable, infinityMessageReactionsTable, infinityUserNotificationsTable, infinityWalletTable, infinityWalletTxnsTable } from "@workspace/db";
import { eq, or, and, desc, asc, ne, sql, inArray, lt, like } from "drizzle-orm";
import { requireAuth } from "../lib/infinity-auth.js";
import { logger } from "../lib/logger.js";
import { randomBytes } from "node:crypto";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeUsername(u: unknown): string | null {
  if (typeof u !== "string" || !/^[a-zA-Z0-9_\-\.]{2,32}$/.test(u.trim())) return null;
  return u.trim().toLowerCase();
}

type SocialLink = { type: string; value: string };

function sanitizeLinks(links: unknown): SocialLink[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter((l): l is SocialLink => l && typeof l === "object" && typeof (l as SocialLink).type === "string" && typeof (l as SocialLink).value === "string")
    .slice(0, 8)
    .map(l => ({ type: l.type.slice(0, 20), value: l.value.slice(0, 120) }));
}

function publicProfile(row: typeof infinityUsersTable.$inferSelect) {
  const links = Array.isArray(row.profileSocialLinks) ? row.profileSocialLinks : [];
  const now = new Date();
  const isPro = row.planType === "pro" && (row.planExpiresAt == null || row.planExpiresAt > now);
  return {
    username:     row.username,
    displayName:  row.displayName ?? row.username,
    role:         row.role,
    bio:          row.profileBio ?? null,
    status:       row.profileStatus ?? "online",
    statusMsg:    row.profileStatusMsg ?? null,
    photo:        row.profilePhoto ?? null,
    banner:       row.profileBanner ?? null,
    location:     row.profileLocation ?? null,
    musicUrl:     row.profileMusicUrl ?? null,
    socialLinks:  links,
    accentColor:  row.profileAccentColor ?? null,
    bgType:       row.profileBgType ?? "default",
    bgValue:      row.profileBgValue ?? null,
    cardTheme:    row.cardTheme ?? "default",
    planType:     isPro ? "pro" : "free",
    views:        row.profileViews ?? 0,
    createdAt:    row.createdAt,
  };
}

// Push notification helper — broadcasts to connected WS clients
function pushUserNotification(username: string, payload: object) {
  if (typeof globalThis.__notifyUser === "function") {
    globalThis.__notifyUser(username, payload);
  }
}

// ── GET /api/infinity/u/:username — public profile (NO auth required) ──────────
router.get("/u/:username", async (req, res): Promise<void> => {
  const { username } = req.params as { username: string };
  const u = safeUsername(username);
  if (!u) { res.status(400).json({ error: "Username inválido" }); return; }

  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, u)).limit(1);
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

    db.update(infinityUsersTable)
      .set({ profileViews: sql`${infinityUsersTable.profileViews} + 1` })
      .where(eq(infinityUsersTable.username, u))
      .catch(() => {});

    res.json(publicProfile(row));
  } catch (err) {
    logger.error({ err }, "Failed to fetch public profile");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── PATCH /api/infinity/me/social ────────────────────────────────────────────────
router.patch("/me/social", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { location, musicUrl, socialLinks, accentColor, bgType, bgValue, cardTheme } = req.body as Record<string, unknown>;

  const patch: Partial<typeof infinityUsersTable.$inferInsert> = {};
  if (typeof location === "string" || location === null) patch.profileLocation = typeof location === "string" ? location.slice(0, 60) : null;
  if (typeof musicUrl === "string" || musicUrl === null) patch.profileMusicUrl = typeof musicUrl === "string" ? musicUrl.slice(0, 200) : null;
  if (Array.isArray(socialLinks)) patch.profileSocialLinks = sanitizeLinks(socialLinks) as any;
  if (typeof accentColor === "string" || accentColor === null) patch.profileAccentColor = typeof accentColor === "string" ? accentColor.slice(0, 20) : null;
  if (typeof bgType === "string") patch.profileBgType = bgType.slice(0, 20);
  if (typeof bgValue === "string" || bgValue === null) patch.profileBgValue = typeof bgValue === "string" ? bgValue.slice(0, 500) : null;
  if (typeof cardTheme === "string") {
    // Validate theme against allowed themes by plan
    const userRow = await db.select({ planType: infinityUsersTable.planType, planExpiresAt: infinityUsersTable.planExpiresAt }).from(infinityUsersTable).where(eq(infinityUsersTable.username, me)).limit(1);
    const row = userRow[0];
    const isPro = row?.planType === "pro" && (row.planExpiresAt == null || row.planExpiresAt > new Date());
    const isAdmin = req.infinityUser!.role === "admin";
    const PRO_THEMES = ["aurora", "matrix", "neon", "holographic", "particles", "glitch", "cyberpunk"];
    if (PRO_THEMES.includes(cardTheme) && !isPro && !isAdmin) {
      res.status(403).json({ error: "Tema PRO — faça upgrade do plano para usar este tema." }); return;
    }
    patch.cardTheme = cardTheme.slice(0, 30);
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nenhum campo para atualizar" }); return; }

  try {
    await db.update(infinityUsersTable).set(patch).where(eq(infinityUsersTable.username, me));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update social profile");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── GET /api/infinity/me/social ────────────────────────────────────────────────
router.get("/me/social", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  try {
    const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, me)).limit(1);
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
    res.json(publicProfile(row));
  } catch (err) {
    logger.error({ err }, "Failed to fetch my social profile");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/me/plan/buy — buy pro plan from wallet ─────────────────
router.post("/me/plan/buy", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const PLAN_COST_CENTS = 299; // $2.99

  try {
    const walletRows = await db.select().from(infinityWalletTable).where(eq(infinityWalletTable.username, me)).limit(1);
    const wallet = walletRows[0];
    const balance = wallet?.balanceCents ?? 0;

    if (balance < PLAN_COST_CENTS) {
      res.status(402).json({ error: `Saldo insuficiente. Você tem R$${(balance / 100).toFixed(2)}, necessário R$${(PLAN_COST_CENTS / 100).toFixed(2)}.` }); return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Atomic: debit wallet + set plan
    await db.transaction(async (tx) => {
      await tx.update(infinityWalletTable)
        .set({ balanceCents: sql`${infinityWalletTable.balanceCents} - ${PLAN_COST_CENTS}`, updatedAt: new Date() })
        .where(eq(infinityWalletTable.username, me));
      await tx.insert(infinityWalletTxnsTable).values({
        username: me,
        direction: "debit",
        amountCents: PLAN_COST_CENTS,
        description: "Plano Hydra PRO — 30 dias",
        refId: `plan-${Date.now()}`,
      });
      await tx.update(infinityUsersTable)
        .set({ planType: "pro", planExpiresAt: expiresAt })
        .where(eq(infinityUsersTable.username, me));
    });

    res.json({ ok: true, planType: "pro", expiresAt });
  } catch (err) {
    logger.error({ err }, "Failed to buy plan");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Friends ───────────────────────────────────────────────────────────────────

router.get("/friends", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  try {
    const rows = await db.select().from(infinityFriendshipsTable).where(or(
      eq(infinityFriendshipsTable.requesterUsername, me),
      eq(infinityFriendshipsTable.addresseeUsername, me),
    ));

    const friends: { id: number; username: string; status: string; direction: "sent" | "received" }[] = [];
    const usernamesNeeded = new Set<string>();
    for (const r of rows) {
      if (r.status === "blocked") continue;
      const other = r.requesterUsername === me ? r.addresseeUsername : r.requesterUsername;
      const dir = r.requesterUsername === me ? "sent" : "received";
      friends.push({ id: r.id, username: other, status: r.status, direction: dir });
      usernamesNeeded.add(other);
    }

    let profileMap: Record<string, { displayName: string | null; photo: string | null; status: string | null; role: string }> = {};
    if (usernamesNeeded.size > 0) {
      const profiles = await db.select({ username: infinityUsersTable.username, displayName: infinityUsersTable.displayName, photo: infinityUsersTable.profilePhoto, status: infinityUsersTable.profileStatus, role: infinityUsersTable.role }).from(infinityUsersTable).where(inArray(infinityUsersTable.username, [...usernamesNeeded]));
      for (const p of profiles) profileMap[p.username] = { displayName: p.displayName, photo: p.photo, status: p.status, role: p.role };
    }

    res.json(friends.map(f => ({
      ...f,
      displayName: profileMap[f.username]?.displayName ?? f.username,
      photo: profileMap[f.username]?.photo ?? null,
      status: profileMap[f.username]?.status ?? "offline",
      role: profileMap[f.username]?.role ?? "user",
    })));
  } catch (err) {
    logger.error({ err }, "Failed to list friends");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/friends/request", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { username } = req.body as { username: string };
  const target = safeUsername(username);
  if (!target) { res.status(400).json({ error: "Username inválido" }); return; }
  if (target === me) { res.status(400).json({ error: "Você não pode se adicionar" }); return; }

  try {
    const targetRows = await db.select({ username: infinityUsersTable.username }).from(infinityUsersTable).where(eq(infinityUsersTable.username, target)).limit(1);
    if (!targetRows[0]) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

    const existing = await db.select().from(infinityFriendshipsTable).where(or(
      and(eq(infinityFriendshipsTable.requesterUsername, me), eq(infinityFriendshipsTable.addresseeUsername, target)),
      and(eq(infinityFriendshipsTable.requesterUsername, target), eq(infinityFriendshipsTable.addresseeUsername, me)),
    )).limit(1);

    if (existing[0]) {
      const e = existing[0];
      if (e.status === "accepted") { res.status(409).json({ error: "Já são amigos" }); return; }
      if (e.status === "pending") { res.status(409).json({ error: "Pedido já enviado ou pendente" }); return; }
      await db.update(infinityFriendshipsTable).set({ status: "pending", requesterUsername: me, addresseeUsername: target, updatedAt: new Date() }).where(eq(infinityFriendshipsTable.id, e.id));
      res.json({ ok: true, message: "Pedido reenviado" }); return;
    }

    const [created] = await db.insert(infinityFriendshipsTable).values({ requesterUsername: me, addresseeUsername: target, status: "pending" }).returning();

    // Create personal notification for target
    const [notif] = await db.insert(infinityUserNotificationsTable).values({ username: target, type: "friend_request", fromUser: me, data: { friendshipId: created!.id } }).returning();
    pushUserNotification(target, { type: "notification", notification: notif });

    res.json({ ok: true, id: created!.id, message: "Pedido enviado" });
  } catch (err) {
    logger.error({ err }, "Failed to send friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/friends/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    const rows = await db.select().from(infinityFriendshipsTable).where(and(eq(infinityFriendshipsTable.id, id), eq(infinityFriendshipsTable.addresseeUsername, me), eq(infinityFriendshipsTable.status, "pending"))).limit(1);
    if (!rows[0]) { res.status(404).json({ error: "Pedido não encontrado" }); return; }

    await db.update(infinityFriendshipsTable).set({ status: "accepted", updatedAt: new Date() }).where(eq(infinityFriendshipsTable.id, id));

    // Notify requester that their request was accepted
    const [notif] = await db.insert(infinityUserNotificationsTable).values({ username: rows[0].requesterUsername, type: "friend_accept", fromUser: me, data: { friendshipId: id } }).returning();
    pushUserNotification(rows[0].requesterUsername, { type: "notification", notification: notif });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to accept friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/friends/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    await db.update(infinityFriendshipsTable).set({ status: "declined", updatedAt: new Date() }).where(and(eq(infinityFriendshipsTable.id, id), or(eq(infinityFriendshipsTable.addresseeUsername, me), eq(infinityFriendshipsTable.requesterUsername, me))));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to decline friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/friends/:id", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  try {
    await db.delete(infinityFriendshipsTable).where(and(eq(infinityFriendshipsTable.id, id), or(eq(infinityFriendshipsTable.requesterUsername, me), eq(infinityFriendshipsTable.addresseeUsername, me))));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove friend");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── DMs ───────────────────────────────────────────────────────────────────────

router.get("/me/dm/:username", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { username } = req.params as { username: string };
  const other = safeUsername(username);
  if (!other) { res.status(400).json({ error: "Username inválido" }); return; }
  if (other === me) { res.status(400).json({ error: "Não pode criar DM consigo mesmo" }); return; }

  // Deterministic slug: dm:alpha:beta (alphabetical order)
  const [a, b] = [me, other].sort();
  const slug = `dm:${a}:${b}`;

  try {
    // Check target exists
    const targetRows = await db.select({ username: infinityUsersTable.username, displayName: infinityUsersTable.displayName, profilePhoto: infinityUsersTable.profilePhoto, profileAccentColor: infinityUsersTable.profileAccentColor }).from(infinityUsersTable).where(eq(infinityUsersTable.username, other)).limit(1);
    if (!targetRows[0]) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

    // Get or create DM room
    const existing = await db.select().from(infinityChatRoomsTable).where(eq(infinityChatRoomsTable.slug, slug)).limit(1);
    let room = existing[0];
    if (!room) {
      [room] = await db.insert(infinityChatRoomsTable).values({
        slug,
        name: `DM: ${me} ↔ ${other}`,
        type: "dm",
        createdBy: me,
        description: `Conversa privada entre ${me} e ${other}`,
        icon: "💬",
      }).onConflictDoNothing().returning();
      if (!room) {
        const rows2 = await db.select().from(infinityChatRoomsTable).where(eq(infinityChatRoomsTable.slug, slug)).limit(1);
        room = rows2[0]!;
      }
    }

    res.json({ room, otherUser: targetRows[0] });
  } catch (err) {
    logger.error({ err }, "Failed to get/create DM room");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── List my DMs ───────────────────────────────────────────────────────────────

router.get("/me/dms", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  try {
    const dmRooms = await db.select()
      .from(infinityChatRoomsTable)
      .where(
        and(
          eq(infinityChatRoomsTable.type, "dm"),
          or(
            like(infinityChatRoomsTable.slug, `dm:${me}:%`),
            like(infinityChatRoomsTable.slug, `dm:%:${me}`)
          )
        )
      );

    const results = await Promise.all(dmRooms.map(async (room) => {
      const parts = room.slug.split(":");
      const otherUsername = parts[1] === me ? parts[2] : parts[1];

      const [otherUser] = await db.select({
        username: infinityUsersTable.username,
        displayName: infinityUsersTable.displayName,
        profilePhoto: infinityUsersTable.profilePhoto,
        profileAccentColor: infinityUsersTable.profileAccentColor,
      }).from(infinityUsersTable).where(eq(infinityUsersTable.username, otherUsername!)).limit(1);

      const [lastMsg] = await db.select({
        content: infinityChatMessagesTable.content,
        username: infinityChatMessagesTable.username,
        createdAt: infinityChatMessagesTable.createdAt,
      }).from(infinityChatMessagesTable)
        .where(eq(infinityChatMessagesTable.roomSlug, room.slug))
        .orderBy(desc(infinityChatMessagesTable.createdAt))
        .limit(1);

      return { room, otherUser: otherUser ?? null, lastMessage: lastMsg ?? null };
    }));

    results.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ? new Date(String(a.lastMessage.createdAt)).getTime() : 0;
      const bTime = b.lastMessage?.createdAt ? new Date(String(b.lastMessage.createdAt)).getTime() : 0;
      return bTime - aTime;
    });

    res.json(results);
  } catch (err) {
    logger.error({ err }, "Failed to list DMs");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Chat Rooms ────────────────────────────────────────────────────────────────

router.get("/chat/rooms", requireAuth, async (req, res): Promise<void> => {
  try {
    const rooms = await db.select().from(infinityChatRoomsTable).where(ne(infinityChatRoomsTable.type, "dm")).orderBy(asc(infinityChatRoomsTable.createdAt));
    const hasGlobal = rooms.some(r => r.slug === "global");
    if (!hasGlobal) {
      const [g] = await db.insert(infinityChatRoomsTable).values({ slug: "global", name: "Global", type: "global", createdBy: "system", description: "Chat geral da Hydra Consultoria", icon: "🌐" }).returning().onConflictDoNothing();
      if (g) rooms.unshift(g);
    }
    res.json(rooms.sort((a, b) => (a.slug === "global" ? -1 : b.slug === "global" ? 1 : 0)));
  } catch (err) {
    logger.error({ err }, "Failed to list chat rooms");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/chat/rooms", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { name, description, icon } = req.body as { name?: string; description?: string; icon?: string };
  if (!name || typeof name !== "string" || name.trim().length < 2) { res.status(400).json({ error: "Nome precisa ter ao menos 2 caracteres" }); return; }
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);
  try {
    const [room] = await db.insert(infinityChatRoomsTable).values({ slug, name: name.trim().slice(0, 50), type: "public", createdBy: me, description: typeof description === "string" ? description.slice(0, 200) : null, icon: typeof icon === "string" ? icon.slice(0, 4) : "💬" }).returning();
    res.json(room);
  } catch (err) {
    logger.error({ err }, "Failed to create chat room");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/chat/rooms/:slug/messages", requireAuth, async (req, res): Promise<void> => {
  const { slug } = req.params as { slug: string };
  const limit = Math.min(100, parseInt((req.query as Record<string, string>).limit ?? "50", 10));

  try {
    const msgs = await db
      .select({
        id: infinityChatMessagesTable.id,
        roomSlug: infinityChatMessagesTable.roomSlug,
        username: infinityChatMessagesTable.username,
        content: infinityChatMessagesTable.content,
        replyToId: infinityChatMessagesTable.replyToId,
        replyToUsername: infinityChatMessagesTable.replyToUsername,
        replyToContent: infinityChatMessagesTable.replyToContent,
        createdAt: infinityChatMessagesTable.createdAt,
        displayName: infinityUsersTable.displayName,
        photo: infinityUsersTable.profilePhoto,
        role: infinityUsersTable.role,
        accentColor: infinityUsersTable.profileAccentColor,
      })
      .from(infinityChatMessagesTable)
      .leftJoin(infinityUsersTable, eq(infinityUsersTable.username, infinityChatMessagesTable.username))
      .where(eq(infinityChatMessagesTable.roomSlug, slug))
      .orderBy(desc(infinityChatMessagesTable.id))
      .limit(limit);

    const msgIds = msgs.map(m => m.id);
    let reactionsMap: Record<number, { emoji: string; count: number; users: string[] }[]> = {};
    if (msgIds.length > 0) {
      const reactions = await db.select().from(infinityMessageReactionsTable).where(inArray(infinityMessageReactionsTable.messageId, msgIds));
      for (const r of reactions) {
        if (!reactionsMap[r.messageId]) reactionsMap[r.messageId] = [];
        const ex = reactionsMap[r.messageId]!.find(x => x.emoji === r.emoji);
        if (ex) { ex.count++; ex.users.push(r.username); }
        else reactionsMap[r.messageId]!.push({ emoji: r.emoji, count: 1, users: [r.username] });
      }
    }

    res.json(msgs.reverse().map(m => ({ ...m, reactions: reactionsMap[m.id] ?? [] })));
  } catch (err) {
    logger.error({ err }, "Failed to fetch chat messages");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/chat/rooms/:slug/members", requireAuth, async (req, res): Promise<void> => {
  const { slug } = req.params as { slug: string };
  try {
    const recent = await db
      .select({
        username: infinityChatMessagesTable.username,
        displayName: infinityUsersTable.displayName,
        photo: infinityUsersTable.profilePhoto,
        accentColor: infinityUsersTable.profileAccentColor,
      })
      .from(infinityChatMessagesTable)
      .leftJoin(infinityUsersTable, eq(infinityUsersTable.username, infinityChatMessagesTable.username))
      .where(eq(infinityChatMessagesTable.roomSlug, slug))
      .orderBy(desc(infinityChatMessagesTable.id))
      .limit(200);
    const seen = new Set<string>();
    const members: { username: string; displayName: string | null; photo: string | null; accentColor: string | null }[] = [];
    for (const r of recent) {
      if (!seen.has(r.username)) {
        seen.add(r.username);
        members.push(r);
      }
    }
    res.json(members.slice(0, 50));
  } catch (err) {
    logger.error({ err }, "Failed to fetch room members");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/chat/rooms/:slug/messages", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { slug } = req.params as { slug: string };
  const { content, replyToId } = req.body as { content?: string; replyToId?: number };
  if (!content || typeof content !== "string" || content.trim().length === 0) { res.status(400).json({ error: "Mensagem vazia" }); return; }
  if (content.trim().length > 2000) { res.status(400).json({ error: "Mensagem muito longa (máx 2000 chars)" }); return; }

  try {
    const roomRows = await db.select({ id: infinityChatRoomsTable.id }).from(infinityChatRoomsTable).where(eq(infinityChatRoomsTable.slug, slug)).limit(1);
    if (!roomRows[0]) { res.status(404).json({ error: "Sala não encontrada" }); return; }

    const userRows = await db.select({ displayName: infinityUsersTable.displayName, photo: infinityUsersTable.profilePhoto, role: infinityUsersTable.role, accentColor: infinityUsersTable.profileAccentColor }).from(infinityUsersTable).where(eq(infinityUsersTable.username, me)).limit(1);
    const userProfile = userRows[0];

    let replyToUsername: string | null = null;
    let replyToContent: string | null = null;
    if (replyToId && typeof replyToId === "number") {
      const orig = await db.select({ username: infinityChatMessagesTable.username, content: infinityChatMessagesTable.content }).from(infinityChatMessagesTable).where(eq(infinityChatMessagesTable.id, replyToId)).limit(1);
      if (orig[0]) { replyToUsername = orig[0].username; replyToContent = orig[0].content.slice(0, 200); }
    }

    const [msg] = await db.insert(infinityChatMessagesTable).values({ roomSlug: slug, username: me, content: content.trim(), replyToId: replyToUsername ? (replyToId ?? null) : null, replyToUsername, replyToContent }).returning();
    const fullMsg = { ...msg, displayName: userProfile?.displayName ?? me, photo: userProfile?.photo ?? null, role: userProfile?.role ?? "user", accentColor: userProfile?.accentColor ?? null, reactions: [] };

    if (globalThis.__chatBroadcast) globalThis.__chatBroadcast(slug, { type: "message", ...fullMsg });

    // DM notification: notify the other participant
    if (slug.startsWith("dm:")) {
      const parts = slug.split(":");
      const other = parts[1] === me ? parts[2] : parts[1];
      if (other) {
        const [notif] = await db.insert(infinityUserNotificationsTable).values({ username: other!, type: "dm", fromUser: me, data: { roomSlug: slug, preview: content.trim().slice(0, 80) } }).returning();
        pushUserNotification(other!, { type: "notification", notification: notif });
      }
    }

    res.json(fullMsg);
  } catch (err) {
    logger.error({ err }, "Failed to post chat message");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────

router.post("/chat/messages/:id/react", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const msgId = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { emoji } = req.body as { emoji?: string };
  if (!emoji || typeof emoji !== "string" || emoji.length > 10) { res.status(400).json({ error: "Emoji inválido" }); return; }

  try {
    // Toggle: if already reacted with same emoji, remove; else add
    const existing = await db.select().from(infinityMessageReactionsTable).where(and(eq(infinityMessageReactionsTable.messageId, msgId), eq(infinityMessageReactionsTable.username, me), eq(infinityMessageReactionsTable.emoji, emoji))).limit(1);

    let added: boolean;
    if (existing[0]) {
      await db.delete(infinityMessageReactionsTable).where(eq(infinityMessageReactionsTable.id, existing[0].id));
      added = false;
    } else {
      await db.insert(infinityMessageReactionsTable).values({ messageId: msgId, username: me, emoji });
      added = true;
    }

    // Get the message to find the room and notify
    const msgRows = await db.select({ roomSlug: infinityChatMessagesTable.roomSlug, username: infinityChatMessagesTable.username }).from(infinityChatMessagesTable).where(eq(infinityChatMessagesTable.id, msgId)).limit(1);
    const msgRow = msgRows[0];

    // Fetch updated reactions for this message
    const allReactions = await db.select().from(infinityMessageReactionsTable).where(eq(infinityMessageReactionsTable.messageId, msgId));
    const reactionSummary: Record<string, { emoji: string; count: number; users: string[] }> = {};
    for (const r of allReactions) {
      if (!reactionSummary[r.emoji]) reactionSummary[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
      reactionSummary[r.emoji]!.count++;
      reactionSummary[r.emoji]!.users.push(r.username);
    }
    const reactions = Object.values(reactionSummary);

    // Broadcast reaction update to room
    if (msgRow && globalThis.__chatBroadcast) {
      globalThis.__chatBroadcast(msgRow.roomSlug, { type: "reaction_update", messageId: msgId, reactions });
    }

    // Notify message author (if not self)
    if (added && msgRow && msgRow.username !== me) {
      const [notif] = await db.insert(infinityUserNotificationsTable).values({ username: msgRow.username, type: "reaction", fromUser: me, data: { messageId: msgId, emoji, roomSlug: msgRow.roomSlug } }).returning();
      pushUserNotification(msgRow.username, { type: "notification", notification: notif });
    }

    res.json({ ok: true, added, reactions });
  } catch (err) {
    logger.error({ err }, "Failed to toggle reaction");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Delete own message ────────────────────────────────────────────────────────

router.delete("/chat/messages/:id", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const msgId = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const rows = await db.select().from(infinityChatMessagesTable)
      .where(eq(infinityChatMessagesTable.id, msgId)).limit(1);
    const msg = rows[0];
    if (!msg) { res.status(404).json({ error: "Mensagem não encontrada" }); return; }
    if (msg.username !== me) { res.status(403).json({ error: "Sem permissão" }); return; }

    await db.delete(infinityMessageReactionsTable).where(eq(infinityMessageReactionsTable.messageId, msgId));
    await db.delete(infinityChatMessagesTable).where(eq(infinityChatMessagesTable.id, msgId));

    if (globalThis.__chatBroadcast) {
      globalThis.__chatBroadcast(msg.roomSlug, { type: "message_delete", messageId: msgId });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete chat message");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Chat image upload (temp in-memory store, 30 min TTL) ──────────────────────
interface ChatImgEntry { mimeType: string; data: string; expires: number }
const _chatImgStore = new Map<string, ChatImgEntry>();
const CHAT_IMG_TTL = 30 * 60 * 1000;
function cleanChatImgStore() {
  const now = Date.now();
  for (const [k, v] of _chatImgStore) if (v.expires < now) _chatImgStore.delete(k);
}

router.post("/chat/upload", requireAuth, async (req, res): Promise<void> => {
  const { dataUri } = req.body as { dataUri?: string };
  if (!dataUri || typeof dataUri !== "string") {
    res.status(400).json({ error: "dataUri obrigatório" }); return;
  }
  const match = /^data:(image\/(jpeg|jpg|png|gif|webp));base64,(.+)$/.exec(dataUri);
  if (!match) {
    res.status(400).json({ error: "Formato inválido. Use PNG, JPEG, GIF ou WEBP." }); return;
  }
  const mimeType = match[1]!;
  const base64Data = match[3]!;
  if (base64Data.length > 3_000_000) {
    res.status(413).json({ error: "Imagem muito grande (máximo ~2MB)." }); return;
  }
  cleanChatImgStore();
  const id = randomBytes(16).toString("hex");
  _chatImgStore.set(id, { mimeType, data: base64Data, expires: Date.now() + CHAT_IMG_TTL });
  res.json({ url: `/api/infinity/chat/img/${id}` });
});

router.get("/chat/img/:id", (req, res): void => {
  const entry = _chatImgStore.get((req.params as { id: string }).id);
  if (!entry || entry.expires < Date.now()) {
    res.status(404).json({ error: "Imagem não encontrada ou expirada" }); return;
  }
  res.setHeader("Content-Type", entry.mimeType);
  res.setHeader("Cache-Control", "public, max-age=1800");
  res.end(Buffer.from(entry.data, "base64"));
});

// ── User search ───────────────────────────────────────────────────────────────

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const q = ((req.query as Record<string, string>).q ?? "").trim().toLowerCase();
  if (q.length < 2) { res.json([]); return; }
  try {
    const rows = await db
      .select({
        username: infinityUsersTable.username,
        displayName: infinityUsersTable.displayName,
        photo: infinityUsersTable.profilePhoto,
        role: infinityUsersTable.role,
        accentColor: infinityUsersTable.profileAccentColor,
        bio: infinityUsersTable.profileBio,
      })
      .from(infinityUsersTable)
      .where(
        or(
          sql`lower(${infinityUsersTable.username}) like ${"%" + q + "%"}`,
          sql`lower(${infinityUsersTable.displayName}) like ${"%" + q + "%"}`
        )
      )
      .limit(15);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to search users");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

router.get("/me/notifications", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  try {
    const notifs = await db.select().from(infinityUserNotificationsTable).where(eq(infinityUserNotificationsTable.username, me)).orderBy(desc(infinityUserNotificationsTable.createdAt)).limit(30);
    res.json(notifs);
  } catch (err) {
    logger.error({ err }, "Failed to fetch notifications");
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/me/notifications/read", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { ids } = req.body as { ids?: number[] };
  try {
    if (ids && ids.length > 0) {
      await db.update(infinityUserNotificationsTable).set({ read: true }).where(and(eq(infinityUserNotificationsTable.username, me), inArray(infinityUserNotificationsTable.id, ids)));
    } else {
      await db.update(infinityUserNotificationsTable).set({ read: true }).where(eq(infinityUserNotificationsTable.username, me));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to mark notifications read");
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
