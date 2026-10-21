import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(root, ".pgdata");
const port = 54330;
const password = "postgres";
const database = "dnawork";

fs.mkdirSync(dataDir, { recursive: true });
const embedded = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
  port,
  persistent: true,
});

const marker = path.join(dataDir, "PG_VERSION");
if (!fs.existsSync(marker)) await embedded.initialise();
await embedded.start();
const admin = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${database}`);
await admin.end();

const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database });
await client.connect();
const sql = fs.readFileSync(path.join(root, "database/schema/local-dev.sql"), "utf8");
await client.query(sql);
await client.end();

const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
console.log(`PostgreSQL local pronto em ${databaseUrl}`);
console.log("Este processo mantém o banco no ar. Encerre com Ctrl+C.");

const stop = async () => {
  await embedded.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => undefined, 60_000);
