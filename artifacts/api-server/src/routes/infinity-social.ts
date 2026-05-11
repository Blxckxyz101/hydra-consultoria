import { Router, type IRouter } from "express";
import { db, infinityUsersTable, infinityFriendshipsTable, infinityChatRoomsTable, infinityChatMessagesTable } from "@workspace/db";
import { eq, or, and, desc, asc, ne, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/infinity-auth.js";
import { logger } from "../lib/logger.js";

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
    views:        row.profileViews ?? 0,
    createdAt:    row.createdAt,
  };
}

// ── GET /api/infinity/u/:username — public profile ─────────────────────────────
router.get("/u/:username", async (req, res): Promise<void> => {
  const { username } = req.params as { username: string };
  const u = safeUsername(username);
  if (!u) { res.status(400).json({ error: "Username inválido" }); return; }

  try {
    const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, u)).limit(1);
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

    // Increment profile views (fire-and-forget)
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

// ── PATCH /api/infinity/me/social — update social profile fields ────────────────
router.patch("/me/social", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { location, musicUrl, socialLinks, accentColor, bgType, bgValue } = req.body as Record<string, unknown>;

  const patch: Partial<typeof infinityUsersTable.$inferInsert> = {};
  if (typeof location === "string" || location === null) patch.profileLocation = typeof location === "string" ? location.slice(0, 60) : null;
  if (typeof musicUrl === "string" || musicUrl === null) patch.profileMusicUrl = typeof musicUrl === "string" ? musicUrl.slice(0, 200) : null;
  if (Array.isArray(socialLinks)) patch.profileSocialLinks = sanitizeLinks(socialLinks) as any;
  if (typeof accentColor === "string" || accentColor === null) patch.profileAccentColor = typeof accentColor === "string" ? accentColor.slice(0, 20) : null;
  if (typeof bgType === "string") patch.profileBgType = bgType.slice(0, 20);
  if (typeof bgValue === "string" || bgValue === null) patch.profileBgValue = typeof bgValue === "string" ? bgValue.slice(0, 500) : null;

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nenhum campo para atualizar" }); return; }

  try {
    await db.update(infinityUsersTable).set(patch).where(eq(infinityUsersTable.username, me));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update social profile");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── GET /api/infinity/me/social — my social profile ──────────────────────────────
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

// ── GET /api/infinity/friends — list friends and pending requests ──────────────
router.get("/friends", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  try {
    const rows = await db
      .select()
      .from(infinityFriendshipsTable)
      .where(or(
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

    // Fetch mini profiles for all users
    let profileMap: Record<string, { displayName: string | null; photo: string | null; status: string | null; role: string }> = {};
    if (usernamesNeeded.size > 0) {
      const profiles = await db
        .select({
          username: infinityUsersTable.username,
          displayName: infinityUsersTable.displayName,
          photo: infinityUsersTable.profilePhoto,
          status: infinityUsersTable.profileStatus,
          role: infinityUsersTable.role,
        })
        .from(infinityUsersTable)
        .where(inArray(infinityUsersTable.username, [...usernamesNeeded]));
      for (const p of profiles) {
        profileMap[p.username] = { displayName: p.displayName, photo: p.photo, status: p.status, role: p.role };
      }
    }

    const result = friends.map(f => ({
      ...f,
      displayName: profileMap[f.username]?.displayName ?? f.username,
      photo: profileMap[f.username]?.photo ?? null,
      status: profileMap[f.username]?.status ?? "offline",
      role: profileMap[f.username]?.role ?? "user",
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list friends");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/friends/request — send friend request ──────────────────
router.post("/friends/request", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { username } = req.body as { username: string };
  const target = safeUsername(username);

  if (!target) { res.status(400).json({ error: "Username inválido" }); return; }
  if (target === me) { res.status(400).json({ error: "Você não pode se adicionar" }); return; }

  try {
    // Check target exists
    const targetRows = await db.select({ username: infinityUsersTable.username }).from(infinityUsersTable).where(eq(infinityUsersTable.username, target)).limit(1);
    if (!targetRows[0]) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

    // Check existing friendship
    const existing = await db.select().from(infinityFriendshipsTable).where(
      or(
        and(eq(infinityFriendshipsTable.requesterUsername, me), eq(infinityFriendshipsTable.addresseeUsername, target)),
        and(eq(infinityFriendshipsTable.requesterUsername, target), eq(infinityFriendshipsTable.addresseeUsername, me)),
      )
    ).limit(1);

    if (existing[0]) {
      const e = existing[0];
      if (e.status === "accepted") { res.status(409).json({ error: "Já são amigos" }); return; }
      if (e.status === "pending") { res.status(409).json({ error: "Pedido já enviado ou pendente" }); return; }
      // Was declined — reset
      await db.update(infinityFriendshipsTable)
        .set({ status: "pending", requesterUsername: me, addresseeUsername: target, updatedAt: new Date() })
        .where(eq(infinityFriendshipsTable.id, e.id));
      res.json({ ok: true, message: "Pedido reenviado" });
      return;
    }

    const [created] = await db.insert(infinityFriendshipsTable).values({
      requesterUsername: me,
      addresseeUsername: target,
      status: "pending",
    }).returning();

    res.json({ ok: true, id: created!.id, message: "Pedido enviado" });
  } catch (err) {
    logger.error({ err }, "Failed to send friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/friends/:id/accept ──────────────────────────────────────
router.post("/friends/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    const rows = await db.select().from(infinityFriendshipsTable).where(
      and(eq(infinityFriendshipsTable.id, id), eq(infinityFriendshipsTable.addresseeUsername, me), eq(infinityFriendshipsTable.status, "pending"))
    ).limit(1);

    if (!rows[0]) { res.status(404).json({ error: "Pedido não encontrado" }); return; }

    await db.update(infinityFriendshipsTable).set({ status: "accepted", updatedAt: new Date() }).where(eq(infinityFriendshipsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to accept friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/friends/:id/decline ────────────────────────────────────
router.post("/friends/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    await db.update(infinityFriendshipsTable)
      .set({ status: "declined", updatedAt: new Date() })
      .where(and(
        eq(infinityFriendshipsTable.id, id),
        or(eq(infinityFriendshipsTable.addresseeUsername, me), eq(infinityFriendshipsTable.requesterUsername, me)),
      ));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to decline friend request");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── DELETE /api/infinity/friends/:id — remove friend ─────────────────────────
router.delete("/friends/:id", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    await db.delete(infinityFriendshipsTable).where(
      and(
        eq(infinityFriendshipsTable.id, id),
        or(eq(infinityFriendshipsTable.requesterUsername, me), eq(infinityFriendshipsTable.addresseeUsername, me)),
      )
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove friend");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── GET /api/infinity/chat/rooms ──────────────────────────────────────────────
router.get("/chat/rooms", requireAuth, async (req, res): Promise<void> => {
  try {
    const rooms = await db
      .select()
      .from(infinityChatRoomsTable)
      .where(ne(infinityChatRoomsTable.type, "private"))
      .orderBy(asc(infinityChatRoomsTable.createdAt));

    // Always include global room
    const hasGlobal = rooms.some(r => r.slug === "global");
    if (!hasGlobal) {
      const [g] = await db.insert(infinityChatRoomsTable).values({
        slug: "global",
        name: "Global",
        type: "global",
        createdBy: "system",
        description: "Chat geral da Hydra Consultoria",
        icon: "🌐",
      }).returning().onConflictDoNothing();
      if (g) rooms.unshift(g);
    }

    res.json(rooms.sort((a, b) => (a.slug === "global" ? -1 : b.slug === "global" ? 1 : 0)));
  } catch (err) {
    logger.error({ err }, "Failed to list chat rooms");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/chat/rooms — create room ────────────────────────────────
router.post("/chat/rooms", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { name, description, icon } = req.body as { name?: string; description?: string; icon?: string };

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Nome precisa ter ao menos 2 caracteres" }); return;
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Date.now().toString(36);

  try {
    const [room] = await db.insert(infinityChatRoomsTable).values({
      slug,
      name: name.trim().slice(0, 50),
      type: "public",
      createdBy: me,
      description: typeof description === "string" ? description.slice(0, 200) : null,
      icon: typeof icon === "string" ? icon.slice(0, 4) : "💬",
    }).returning();

    res.json(room);
  } catch (err) {
    logger.error({ err }, "Failed to create chat room");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── GET /api/infinity/chat/rooms/:slug/messages ─────────────────────────────────
router.get("/chat/rooms/:slug/messages", requireAuth, async (req, res): Promise<void> => {
  const { slug } = req.params as { slug: string };
  const limit = Math.min(100, parseInt((req.query as Record<string, string>).limit ?? "50", 10));
  const before = (req.query as Record<string, string>).before;

  try {
    const msgs = await db
      .select({
        id: infinityChatMessagesTable.id,
        roomSlug: infinityChatMessagesTable.roomSlug,
        username: infinityChatMessagesTable.username,
        content: infinityChatMessagesTable.content,
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

    res.json(msgs.reverse());
  } catch (err) {
    logger.error({ err }, "Failed to fetch chat messages");
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── POST /api/infinity/chat/rooms/:slug/messages — post message (REST fallback) ─
router.post("/chat/rooms/:slug/messages", requireAuth, async (req, res): Promise<void> => {
  const me = req.infinityUser!.username;
  const { slug } = req.params as { slug: string };
  const { content } = req.body as { content?: string };

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "Mensagem vazia" }); return;
  }
  if (content.trim().length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (máx 2000 chars)" }); return;
  }

  try {
    // Verify room exists
    const roomRows = await db.select({ id: infinityChatRoomsTable.id }).from(infinityChatRoomsTable).where(eq(infinityChatRoomsTable.slug, slug)).limit(1);
    if (!roomRows[0]) { res.status(404).json({ error: "Sala não encontrada" }); return; }

    // Get user profile for the response
    const userRows = await db.select({ displayName: infinityUsersTable.displayName, photo: infinityUsersTable.profilePhoto, role: infinityUsersTable.role, accentColor: infinityUsersTable.profileAccentColor }).from(infinityUsersTable).where(eq(infinityUsersTable.username, me)).limit(1);
    const userProfile = userRows[0];

    const [msg] = await db.insert(infinityChatMessagesTable).values({
      roomSlug: slug,
      username: me,
      content: content.trim(),
    }).returning();

    const fullMsg = {
      ...msg,
      displayName: userProfile?.displayName ?? me,
      photo: userProfile?.photo ?? null,
      role: userProfile?.role ?? "user",
      accentColor: userProfile?.accentColor ?? null,
    };

    // Broadcast via WebSocket if available
    if (globalThis.__chatBroadcast) {
      globalThis.__chatBroadcast(slug, { type: "message", ...fullMsg });
    }

    res.json(fullMsg);
  } catch (err) {
    logger.error({ err }, "Failed to post chat message");
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
