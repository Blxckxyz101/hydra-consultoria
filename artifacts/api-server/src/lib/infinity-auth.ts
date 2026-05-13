import type { Request, Response, NextFunction } from "express";
import { db, infinitySessionsTable, infinityUsersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import crypto from "node:crypto";

export type InfinityRole = "admin" | "user";

export interface InfinityAuthUser {
  username: string;
  role: InfinityRole;
  queryDailyLimit: number | null;
  creditBalance: number;
  planQueryQuota: number | null;
  planQueriesUsed: number;
  accountExpiresAt: Date | null;
  planTier: string; // "free" | "padrao" | "vip" | "ultra"
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      infinityUser?: InfinityAuthUser;
    }
  }
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(username: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(infinitySessionsTable).values({ token, username, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(infinitySessionsTable).where(eq(infinitySessionsTable.token, token));
}

export function extractToken(req: Request): string | null {
  const header = String(req.headers["authorization"] ?? "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const cookieHeader = String(req.headers["cookie"] ?? "");
  const m = cookieHeader.match(/infinity_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function lookupUser(token: string): Promise<InfinityAuthUser | null> {
  const now = new Date();
  const rows = await db
    .select({
      username:       infinityUsersTable.username,
      role:           infinityUsersTable.role,
      accountExpiresAt: infinityUsersTable.accountExpiresAt,
      queryDailyLimit:  infinityUsersTable.queryDailyLimit,
      creditBalance:    infinityUsersTable.creditBalance,
      planQueryQuota:   infinityUsersTable.planQueryQuota,
      planQueriesUsed:  infinityUsersTable.planQueriesUsed,
      planTier:         infinityUsersTable.planTier,
    })
    .from(infinitySessionsTable)
    .innerJoin(infinityUsersTable, eq(infinityUsersTable.username, infinitySessionsTable.username))
    .where(and(eq(infinitySessionsTable.token, token), gt(infinitySessionsTable.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Admins are never blocked regardless of account state.
  // Regular users with expired accounts may still log in if they have credits —
  // the query tier enforcement in the route handlers handles access control.
  return {
    username:       row.username,
    role:           (row.role === "admin" ? "admin" : "user"),
    queryDailyLimit: row.queryDailyLimit ?? null,
    creditBalance:   row.creditBalance ?? 0,
    planQueryQuota:  row.planQueryQuota ?? null,
    planQueriesUsed: row.planQueriesUsed ?? 0,
    accountExpiresAt: row.accountExpiresAt ?? null,
    planTier:        row.planTier ?? "free",
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const user = await lookupUser(token);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada" });
    return;
  }
  req.infinityUser = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.infinityUser?.role !== "admin") {
      res.status(403).json({ error: "Acesso negado — somente admin" });
      return;
    }
    next();
  });
}
