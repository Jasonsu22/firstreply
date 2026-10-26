/**
 * Health check for Render and for us: is the database reachable and migrated,
 * and is each integration configured? Reports only true/false for settings, never values.
 */
import { pool } from "@/db";

export async function GET() {
  const checks: Record<string, unknown> = {
    paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    llmConfigured: Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL),
    encryptionKeySet: Boolean(process.env.ENCRYPTION_KEY),
  };

  try {
    const started = Date.now();
    const { rows } = await pool.query<{ migrations: string; merchants: string }>(
      `SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
              (SELECT count(*) FROM merchants) AS merchants`,
    );
    checks.database = { ok: true, latencyMs: Date.now() - started, migrations: Number(rows[0].migrations), merchants: Number(rows[0].merchants) };
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) };
    return Response.json({ ok: false, ...checks }, { status: 503 });
  }

  return Response.json({ ok: true, ...checks });
}
