import type EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

/**
 * Liga o Postgres embutido do teste sem travar.
 *
 * O `embedded.start()` só termina quando a frase "database system is ready to accept connections" chega inteira
 * num mesmo pedaço da saída do Postgres. Com vários testes ligando bancos ao mesmo tempo, às vezes a frase chega
 * partida em dois pedaços e o `start()` nunca termina (a bateria travava). Por isso, além de esperar a frase,
 * tenta conectar no banco: o que acontecer primeiro libera o teste.
 */
export async function ligarBancoEmbutido(embedded: EmbeddedPostgres, conexao: { port: number; user: string; password: string }, limiteMs = 120_000) {
  await embedded.initialise();
  const partida = embedded.start();
  let falhou: unknown;
  let terminou = false;
  partida.then(() => { terminou = true; }, (erro) => { falhou = erro ?? new Error("O Postgres de teste fechou antes de ligar."); });
  const fim = Date.now() + limiteMs;
  for (;;) {
    if (terminou) return;
    if (falhou) throw falhou;
    if (await responde(conexao)) return;
    if (Date.now() > fim) throw new Error(`O Postgres de teste não ligou na porta ${conexao.port} em ${limiteMs / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function responde({ port, user, password }: { port: number; user: string; password: string }) {
  const client = new pg.Client({ host: "127.0.0.1", port, user, password, database: "postgres", connectionTimeoutMillis: 1_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
