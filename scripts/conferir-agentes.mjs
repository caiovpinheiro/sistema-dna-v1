// Confere se toda página de frontend/src/pages tem um agente.md (docs/agentes/README.md).
// Uso: npm run agentes:conferir   (sai com código 1 se faltar algo)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const pastaPaginas = join(raiz, "frontend", "src", "pages");
const indice = readFileSync(join(raiz, "docs", "agentes", "README.md"), "utf8");

const mapa = new Map();
for (const linha of indice.split(/\r?\n/)) {
  const m = linha.match(/^\|\s*([\w.-]+\.tsx)\s*\|(.+)\|\s*$/);
  if (!m) continue;
  const agentes = [...m[2].matchAll(/\(([^)]+\/agente\.md)\)/g)].map((x) => x[1]);
  mapa.set(m[1], agentes);
}

const problemas = [];
for (const arquivo of readdirSync(pastaPaginas).filter((f) => f.endsWith(".tsx"))) {
  const agentes = mapa.get(arquivo);
  if (!agentes?.length) {
    problemas.push(`${arquivo}: sem agente na tabela de docs/agentes/README.md`);
    continue;
  }
  for (const agente of agentes) {
    if (!existsSync(join(raiz, "docs", "agentes", agente))) problemas.push(`${arquivo}: falta docs/agentes/${agente}`);
  }
}
for (const arquivo of mapa.keys()) {
  if (!existsSync(join(pastaPaginas, arquivo))) problemas.push(`${arquivo}: está na tabela, mas a página não existe mais`);
}

if (problemas.length) {
  console.error("Agentes desatualizados:\n- " + problemas.join("\n- "));
  process.exit(1);
}
console.log(`Ok: ${mapa.size} páginas, todas com agente.md.`);
