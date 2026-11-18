import dns from "node:dns";
import { loadConfig } from "./config.js";
import { loadCapabilities } from "./db/capabilities.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

// Prefere IPv4: alguns serviços de CEP falham por IPv6 no servidor publicado.
dns.setDefaultResultOrder("ipv4first");

const config = loadConfig();
const db = createPool(config);
const capabilities = await loadCapabilities(db);
if (capabilities.missing.length) {
  console.warn(`Migrations da V1 ainda não aplicadas: ${capabilities.missing.join(", ")}`);
}
// Sync agendado (Notion) desligado: só liga com NOTION_SYNC_AGENDA=1. O Lightsail não é mais usado.
const agendarSyncNotion = process.env.NOTION_SYNC_AGENDA === "1";
const app = await buildApp({ config, db, capabilities, agendarSyncNotion });
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : config.HOST;
await app.listen({ port: config.PORT, host });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
