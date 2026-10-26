/** Applies pending migrations from ./drizzle. Runs locally (`npm run db:migrate`) and on every Render deploy. */
import "@/lib/load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/db";

async function main() {
  const started = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Migrations applied in ${Date.now() - started} ms`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
