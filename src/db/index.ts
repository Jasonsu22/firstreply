import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL (see .env.example)");
  return new Pool({
    connectionString,
    max: 10,
    // Render's managed Postgres requires TLS; local Docker doesn't.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
}

// Reuse one pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool };
export const pool = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
