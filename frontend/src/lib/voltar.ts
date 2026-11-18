/**
 * "Voltar" para a página de onde a pessoa veio, não para uma lista fixa.
 * O caminho de navegação da aba fica no sessionStorage como uma pilha: ao abrir uma página que já está na
 * pilha (voltou para ela), tudo que veio depois sai. Assim Empresa → Vaga → Processo → Vaga volta para a Empresa.
 */

const CHAVE = "dnawork-caminho";
const LIMITE = 30;

/** Caminho sem a busca (?…), para comparar páginas. */
function pagina(caminho: string) {
  return caminho.split("?")[0].replace(/\/+$/, "") || "/";
}

/** Formulários (novo, nova, editar) e o login não são destino de "Voltar". */
function ehFormulario(caminho: string) {
  const p = pagina(caminho);
  return p === "/login" || /\/(novo|nova|editar|gerar)$/.test(p);
}

/** Acrescenta a página atual à pilha. Mesma página com outra busca só atualiza a busca. */
export function empilhar(pilha: string[], caminho: string): string[] {
  const atual = pagina(caminho);
  const indice = pilha.findIndex((item) => pagina(item) === atual);
  const base = indice >= 0 ? pilha.slice(0, indice) : pilha;
  return [...base, caminho].slice(-LIMITE);
}

/**
 * Destino do "Voltar" da página atual: a última página antes dela na pilha que não seja ela mesma,
 * uma página dentro dela (ex.: /vagas/1/editar) nem um formulário. Null quando não há.
 */
export function destinoDeVoltar(pilha: string[], caminhoAtual: string): string | null {
  const atual = pagina(caminhoAtual);
  for (let i = pilha.length - 1; i >= 0; i -= 1) {
    const item = pilha[i];
    const p = pagina(item);
    if (p === atual || p.startsWith(`${atual}/`) || ehFormulario(item)) continue;
    return item;
  }
  return null;
}

const ROTULOS: Array<[RegExp, string]> = [
  [/^\/$/, "Painel"],
  [/^\/empresas\/[^/]+$/, "Empresa"],
  [/^\/empresas$/, "Empresas"],
  [/^\/grupos-empresas$/, "Grupos e empresas"],
  [/^\/vagas\/modelos$/, "Modelos de vaga"],
  [/^\/vagas\/[^/]+$/, "Vaga"],
  [/^\/vagas$/, "Vagas"],
  [/^\/candidatos\/[^/]+$/, "Candidato"],
  [/^\/candidatos$/, "Candidatos"],
  [/^\/processos\/[^/]+$/, "Processo"],
  [/^\/processos$/, "Processos"],
  [/^\/contratacoes\/rescisao\/[^/]+$/, "Rescisão"],
  [/^\/contratacoes\/rescisao$/, "Rescisão"],
  [/^\/contratacoes\/[^/]+$/, "Contratação"],
  [/^\/contratacoes$/, "Contratações"],
  [/^\/termos\/[^/]+$/, "Termo"],
  [/^\/termos/, "Termos"],
  [/^\/financeiro\/holerite\/[^/]+$/, "Folha de holerite"],
  [/^\/financeiro\/holerite$/, "Holerite"],
  [/^\/financeiro\/faturamento$/, "Faturamento"],
  [/^\/financeiro\/contas-a-receber$/, "Contas a receber"],
  [/^\/financeiro/, "Financeiro"],
  [/^\/triagem\/dossie$/, "Gerador de dossiês"],
  [/^\/triagem$/, "Triagem"],
  [/^\/documentos-pendentes$/, "Documentos pendentes"],
  [/^\/metricas$/, "Métricas"],
];

/** Nome curto da página de destino, para o texto do link ("← Empresa"). */
export function rotuloDoCaminho(caminho: string) {
  const p = pagina(caminho);
  return ROTULOS.find(([padrao]) => padrao.test(p))?.[1] ?? "Voltar";
}

function ler(): string[] {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Chamado pelo Shell a cada troca de página. */
export function registrarPagina(caminho: string) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(empilhar(ler(), caminho)));
  } catch {
    // Sem sessionStorage (aba privada etc.): o Voltar cai no destino padrão.
  }
}

/** Para onde o "Voltar" da página atual leva; sem histórico, o destino padrão da página. */
export function voltarPara(caminhoAtual: string, padrao: { to: string; rotulo: string }) {
  // A ficha desenha antes do Shell registrar a página: empilha aqui para cortar o que veio depois dela.
  const destino = destinoDeVoltar(empilhar(ler(), caminhoAtual), caminhoAtual);
  return destino ? { to: destino, rotulo: rotuloDoCaminho(destino) } : padrao;
}
