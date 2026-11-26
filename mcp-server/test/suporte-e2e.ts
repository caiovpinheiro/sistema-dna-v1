import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { buildGateway, type Gateway } from "../src/app.js";
import { lerConfig, type GatewayConfig } from "../src/config.js";
import { criarPki, type Pki } from "../../backend/test/pki-suporte.js";
import { APP_URL, MCP_URL, criarAmbiente, type Ambiente } from "../../backend/test/mcp-suporte.js";

export { APP_URL, MCP_URL };
export const SEGREDO_GW = "segredo-do-gateway-segredo-do-gateway-0123456789";

export async function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
    s.on("error", falha);
  });
}

export type Sistema = {
  amb: Ambiente;
  monolito: FastifyInstance; // listener interno
  portaMonolito: number;
  pki: Pki;
  certs: { ca: string; clienteCert: string; clienteKey: string; servidorCert: string; servidorKey: string };
  gw: Gateway;
  cfg: GatewayConfig;
  base: string;
  /** Sobe outro gateway (ex.: reinício independente ou com certificados diferentes). */
  novoGateway(env?: Record<string, string>, opcoes?: Parameters<typeof buildGateway>[1]): Promise<{ gw: Gateway; base: string; cfg: GatewayConfig; parar(): Promise<void> }>;
  cliente(slug: string, token: string, base?: string): { client: Client; transport: StreamableHTTPClientTransport };
  parar(): Promise<void>;
};

const envDoGateway = (porta: number, portaMonolito: number, c: Sistema["certs"], extra: Record<string, string> = {}) => ({
  NODE_ENV: "test", PORT: String(porta), HOST: "127.0.0.1", LOG_LEVEL: "silent",
  MCP_PUBLIC_URL: MCP_URL, MONOLITO_ISSUER_URL: APP_URL,
  MONOLITO_INTERNAL_URL: `https://localhost:${portaMonolito}`,
  MCP_GATEWAY_KEY_ID: "gw1", MCP_GATEWAY_SECRET: SEGREDO_GW,
  MCP_TLS_CA: c.ca, MCP_TLS_CERT: c.clienteCert, MCP_TLS_KEY: c.clienteKey,
  MCP_ALLOWED_HOSTS: `127.0.0.1:${porta}`, CERT_RECHECK_MS: "200", CONNECT_TIMEOUT_MS: "1500", REQUEST_TIMEOUT_MS: "8000",
  ...extra,
});

/** Monólito REAL (Postgres de teste, listener interno com mTLS) + gateway REAL em HTTP local. */
export async function subirSistema(opcoes: { monolitoEnv?: Record<string, string>; gatewayEnv?: Record<string, string>; aoCriarMonolito?: (internoApp: FastifyInstance) => void } = {}): Promise<Sistema> {
  const pki = criarPki("ca-mcp-teste");
  const servidor = pki.emitir("monolito", { tipo: "servidor", cn: "monolito", san: ["DNS:localhost", "IP:127.0.0.1"] });
  const cliente = pki.emitir("gateway-mcp", { tipo: "cliente", cn: "gateway-mcp" });
  const certs = { ca: pki.ca.cert, clienteCert: cliente.cert, clienteKey: cliente.key, servidorCert: servidor.cert, servidorKey: servidor.key };
  const amb = await criarAmbiente({
    MCP_INTERNAL_INSECURE: "", MCP_INTERNAL_TLS_CERT: certs.servidorCert, MCP_INTERNAL_TLS_KEY: certs.servidorKey, MCP_INTERNAL_TLS_CA: certs.ca,
    MCP_INTERNAL_CLIENTES: "gateway-mcp", MCP_GATEWAY_SECRETS: `gw1:${SEGREDO_GW}`, ...(opcoes.monolitoEnv ?? {}),
  });
  const monolito = amb.app.mcp!.interno;
  opcoes.aoCriarMonolito?.(monolito);
  await monolito.listen({ port: 0, host: "127.0.0.1" });
  const portaMonolito = (monolito.server.address() as net.AddressInfo).port;
  const subir = async (env: Record<string, string> = {}, opts: Parameters<typeof buildGateway>[1] = {}) => {
    const porta = await portaLivre();
    const cfg = lerConfig(envDoGateway(porta, portaMonolito, certs, { ...(opcoes.gatewayEnv ?? {}), ...env }));
    const gw = await buildGateway(cfg, opts);
    await gw.app.listen({ port: porta, host: "127.0.0.1" });
    return { gw, base: `http://127.0.0.1:${porta}`, cfg, parar: async () => { await gw.app.close(); } };
  };
  const primeiro = await subir();
  const aParar: Array<() => Promise<void>> = [];
  return {
    amb, monolito, portaMonolito, pki, certs, gw: primeiro.gw, cfg: primeiro.cfg, base: primeiro.base,
    async novoGateway(env, opts) { const g = await subir(env, opts); aParar.push(g.parar); return g; },
    cliente(slug, token, base = primeiro.base) {
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/${slug}`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
      return { client: new Client({ name: "teste", version: "1.0.0" }, { capabilities: {} }), transport };
    },
    async parar() {
      for (const p of aParar) await p().catch(() => undefined);
      await primeiro.parar().catch(() => undefined);
      await amb.fechar().catch(() => undefined);
      pki.limpar();
    },
  };
}

/** Proxy TCP descartável entre gateway e monólito: permite derrubar, atrasar ou redirecionar o monólito sem mexer no processo dele. */
export class ProxyTcp {
  private srv: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  modo: "repassar" | "buraco-negro" = "repassar";
  constructor(public porta: number, public destino: number) {}
  async iniciar() {
    this.srv = net.createServer((cliente) => {
      this.sockets.add(cliente);
      cliente.on("close", () => this.sockets.delete(cliente));
      cliente.on("error", () => undefined);
      if (this.modo === "buraco-negro") return; // aceita e nunca responde
      const alvo = net.connect(this.destino, "127.0.0.1");
      this.sockets.add(alvo);
      alvo.on("close", () => this.sockets.delete(alvo));
      alvo.on("error", () => cliente.destroy());
      cliente.pipe(alvo); alvo.pipe(cliente);
    });
    await new Promise<void>((ok) => this.srv!.listen(this.porta, "127.0.0.1", ok));
  }
  async parar() {
    for (const so of this.sockets) so.destroy();
    this.sockets.clear();
    await new Promise<void>((ok) => (this.srv ? this.srv.close(() => ok()) : ok()));
    this.srv = null;
  }
}
