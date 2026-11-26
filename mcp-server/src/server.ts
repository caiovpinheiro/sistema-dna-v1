import { buildGateway } from "./app.js";
import { lerConfig, type GatewayConfig } from "./config.js";

let cfg: GatewayConfig;
try {
  cfg = lerConfig();
} catch (e) {
  // Configuração inválida: sai com erro claro (não há como funcionar pela metade).
  console.error(JSON.stringify({ level: "fatal", msg: (e as Error).message }));
  process.exit(1);
}

const { app, verificador } = await buildGateway(cfg);
await app.listen({ port: cfg.port, host: cfg.host });
app.log.info({ porta: cfg.port }, "gateway MCP no ar");
// Já sobe mesmo com o monólito fora do ar: /health fica ok, /ready e as chamadas respondem 503 até ele voltar.
void verificador.verificar(true).then((p) => { if (!p.pronto) app.log.warn({ motivos: p.motivos }, "gateway ainda não está pronto"); });

let encerrando = false;
async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  app.log.info({ sinal }, "encerrando");
  verificador.encerrando = true; // /ready passa a 503: o balanceador para de enviar tráfego
  const forcar = setTimeout(() => { app.log.error("tempo de encerramento esgotado; forçando"); process.exit(1); }, cfg.shutdownTimeoutMs);
  forcar.unref();
  try {
    await app.close(); // termina as requisições em andamento e fecha conexões ociosas
    process.exit(0);
  } catch (e) {
    app.log.error({ mensagem: (e as Error).message }, "falha ao encerrar");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));
// Falha numa promessa isolada não derruba o gateway (evita reinício em laço); só é registrada.
process.on("unhandledRejection", (motivo) => app.log.error({ mensagem: motivo instanceof Error ? motivo.message : String(motivo) }, "promessa rejeitada sem tratamento"));
