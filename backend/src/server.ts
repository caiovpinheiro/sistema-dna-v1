import { loadConfig } from "./config.js";
import { loadCapabilities } from "./db/capabilities.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const db = createPool(config);
const capabilities = await loadCapabilities(db);
if (capabilities.missing.length) {
  console.warn(`Migrations da V1 ainda não aplicadas: ${capabilities.missing.join(", ")}`);
}
const app = await buildApp({ config, db, capabilities });
await app.listen({ port: config.PORT, host: config.HOST });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
