import pg from "pg";
export function createPool(config: { DATABASE_URL: string }): pg.Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    options: "-c search_path=dna_work,public",
  });
}

export function assertLocalDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const host = url.hostname;
  const database = url.pathname.replace(/^\//, "");
  const local = host === "127.0.0.1" || host === "localhost";
  if (!local || database === "dnaworkia") {
    throw new Error("Operação recusada: o alvo não é um PostgreSQL local de desenvolvimento.");
  }
}
