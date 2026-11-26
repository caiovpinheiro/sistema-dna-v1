// Classifica os arquivos alterados em um push/PR para decidir testes e deploys independentes.
// Uso: node scripts/detectar-mudancas.mjs --base <sha> --head <sha>   (ou --arquivos arquivo.txt, um por linha)
// Escreve JSON na saída e, se GITHUB_OUTPUT existir, as chaves para os jobs do GitHub Actions.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const re = (...padroes) => padroes.map((p) => new RegExp(p));
const MCP_CODIGO = re("^mcp-server/(src/|Dockerfile$|package(-lock)?\\.json$|tsconfig\\.json$|\\.dockerignore$)");
const MCP_TESTE = re("^mcp-server/(test/|scripts/)");
const MONOLITO = re(
  "^(backend|frontend)/(src|templates|tessdata)/", "^(backend|frontend)/package\\.json$", "^(backend|frontend)/(tsconfig|vite\\.config|index\\.html)",
  "^prisma/", "^templates/", "^Dockerfile$", "^docker-entrypoint\\.sh$", "^package(-lock)?\\.json$", "^scripts/migrate-production\\.mjs$",
);
// Arquivos que definem o contrato interno gateway <-> monólito: mudar qualquer um exige os dois lados, monólito primeiro.
const CONTRATO = re(
  "^backend/src/mcp/(assinatura|interno|tls-interno)\\.ts$", "^mcp-server/src/(assinatura|monolito|tls)\\.ts$", "^docs/mcp/contrato", "^backend/src/mcp/config\\.ts$",
);
const MIGRACAO = re("^prisma/migrations/");
const MCP_NO_MONOLITO = re("^backend/(src/mcp/|test/(mcp|pki))"); // código MCP do monólito: conta como monólito

const alguma = (lista, arquivo) => lista.some((r) => r.test(arquivo));

export function classificar(arquivos) {
  const r = { mcp_codigo: false, mcp_teste: false, monolito: false, contrato: false, migracao: false, somente_docs: true, arquivos: arquivos.length };
  for (const a of arquivos) {
    if (alguma(MCP_CODIGO, a)) r.mcp_codigo = true;
    if (alguma(MCP_TESTE, a)) r.mcp_teste = true;
    if (alguma(MONOLITO, a)) r.monolito = true;
    if (alguma(CONTRATO, a)) r.contrato = true;
    if (alguma(MIGRACAO, a)) r.migracao = true;
    if (!/^(docs\/|.*\.md$|\.github\/|\.gitignore$|\.env\.example$)/.test(a)) r.somente_docs = false;
  }
  const backendMcp = arquivos.some((a) => alguma(MCP_NO_MONOLITO, a));
  if (backendMcp) r.monolito = true;
  // Testes: tudo que muda código roda a suíte do lado correspondente; contrato roda os dois.
  r.testar_monolito = r.monolito || r.contrato || r.migracao;
  r.testar_mcp = r.mcp_codigo || r.mcp_teste || r.contrato;
  r.deploy_monolito = r.monolito || r.contrato || r.migracao;
  r.deploy_mcp = r.mcp_codigo || r.contrato;
  r.compartilhado = r.contrato || (r.deploy_monolito && r.deploy_mcp);
  // Ordem segura: o monólito sempre vai antes (ele aceita N e N-1 do contrato e aplica migrations aditivas).
  r.ordem = r.deploy_monolito && r.deploy_mcp ? "monolito-depois-mcp" : r.deploy_monolito ? "somente-monolito" : r.deploy_mcp ? "somente-mcp" : "nenhum";
  return r;
}

function arquivosDoGit(base, head) {
  const zero = /^0+$/.test(base ?? "");
  if (!base || zero) return execFileSync("git", ["ls-tree", "-r", "--name-only", head ?? "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean);
  return execFileSync("git", ["diff", "--name-only", `${base}...${head ?? "HEAD"}`], { encoding: "utf8" }).split("\n").filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const arquivos = arg("--arquivos") ? readFileSync(arg("--arquivos"), "utf8").split("\n").filter(Boolean) : arquivosDoGit(arg("--base"), arg("--head"));
  const r = classificar(arquivos);
  console.log(JSON.stringify(r, null, 2));
  if (process.env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(r)) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}
