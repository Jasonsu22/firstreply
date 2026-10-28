/**
 * Resets and seeds the demo store. Safe to re-run.
 *
 *   npm run db:seed                 # reset the demo store
 *   npm run db:reset                # same (alias)
 *   npm run db:seed -- --if-empty   # only seed a fresh database (Render startup)
 */
import "@/lib/load-env";
import { pool } from "@/db";
import { resetDemoStore } from "@/lib/demo/seed-store";

async function main() {
  const result = await resetDemoStore({ ifEmpty: process.argv.includes("--if-empty") });
  if ("skipped" in result) return;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
