import type { Request, Response, NextFunction } from "express";
import { db, infinitySessionsTable, infinityUsersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import crypto from "node:crypto";

export type InfinityRole = "admin" | "user";

export interface InfinityAuthUser {
  username: string;
  role: InfinityRole;
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
      username: infinityUsersTable.username,
      role: infinityUsersTable.role,
    })
    .from(infinitySessionsTable)
    .innerJoin(infinityUsersTable, eq(infinityUsersTable.username, infinitySessionsTable.username))
    .where(and(eq(infinitySessionsTable.token, token), gt(infinitySessionsTable.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { username: row.username, role: (row.role === "admin" ? "admin" : "user") };
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
