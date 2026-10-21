import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const baseline = "20261021180000_baseline";
const prisma = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const table = await client.query(
  `SELECT 1
   FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`,
);
let baselineApplied = false;
if (table.rowCount) {
  const applied = await client.query(
    `SELECT 1
     FROM public._prisma_migrations
     WHERE migration_name = $1
       AND finished_at IS NOT NULL
       AND rolled_back_at IS NULL`,
    [baseline],
  );
  baselineApplied = applied.rowCount > 0;
}
await client.end();

if (!baselineApplied) {
  execFileSync(process.execPath, [prisma, "migrate", "resolve", "--applied", baseline], { stdio: "inherit" });
}

execFileSync(process.execPath, [prisma, "migrate", "deploy"], { stdio: "inherit" });
