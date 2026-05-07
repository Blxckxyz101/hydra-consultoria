import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Always enforce SSL for Neon / cloud Postgres — prevents MITM on the DB connection.
// NODE_ENV=development with a local Postgres (no SSL) can override via DATABASE_URL ?sslmode=disable
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: true },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
