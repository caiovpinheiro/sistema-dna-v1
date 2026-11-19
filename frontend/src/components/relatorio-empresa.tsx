import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Pencil, Plus, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { Alerta } from "@/components/pagina";
import { Button, Card, Input, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, money, textoPlano } from "@/lib/format";

type Item = {
  nome: string | null;
  cargo: string | null;
  modalidade: string | null;
  inicio: string | null;
  situacao: string;
  valor: number;
  /** Só no relatório consolidado: a unidade (filial) da linha. */
  unidade?: string | null;
};

type Relatorio = {
  empresa: string | null;
  cnpj: string | null;
  email: string | null;
  /** Linhas que valem: as salvas sem enviar, se houver, senão as calculadas. */
  total: number;
  itens: Item[];
  calculado?: { total: number; itens: Item[] };
  editado?: { atualizado_em: string } | null;
};

type Linha = Item & { chave: string; incluida: boolean; valorTexto: string; nova?: boolean };

let sequencia = 0;

function numero(texto: string) {
  const limpo = texto.trim();
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normal);
  return Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

function linhasDe(itens: Item[]): Linha[] {
  return itens.map((item, index) => ({
    ...item,
    chave: `${index}-${item.nome ?? ""}-${item.inicio ?? ""}`,
    incluida: true,
    valorTexto: Number(item.valor).toFixed(2).replace(".", ","),
  }));
}

/** Linha em branco para cobrança retroativa (ou qualquer acréscimo). */
function linhaNova(): Linha {
  sequencia += 1;
  return { chave: `nova-${sequencia}`, nova: true, incluida: true, nome: "", cargo: "", modalidade: "", inicio: null, situacao: "Retroativo", valor: 0, valorTexto: "", unidade: "" };
}

function quando(iso: string) {
  // Postgres manda "2026-11-17 16:29:17.2+00": vira ISO ("T" e fuso com minutos).
  const data = new Date(iso.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function celulaCsv(valor: string) {
  const texto = valor.replaceAll("\"", "\"\"");
  return /[;"\r\n]/.test(texto) ? `"${texto}"` : texto;
}

function baixarRelatorio(nome: string, conteudo: string) {
  const blob = new Blob(["\uFEFF" + conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

export function RelatorioEmpresaPainel({
  empresaId,
  mes,
  ano,
  consolidado = false,
  onClose,
  onEnviado,
}: {
  empresaId: string;
  mes: string;
  ano: string;
  /** Cobrança "Faturamento M/AAAA consolidado …": junta a matriz e as filiais cobradas por ela, com a coluna Unidade. */
  consolidado?: boolean;
  onClose: () => void;
  onEnviado?: () => void;
}) {
  const client = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [aviso, setAviso] = useState("");
  const [carregada, setCarregada] = useState("");
  const competencia = Boolean(mes && ano);
  const chave = `${empresaId}|${mes}|${ano}|${consolidado ? "consolidado" : ""}`;
  const parametros = { empresa: empresaId, mes, ano, ...(consolidado ? { consolidado: "1" } : {}) };
  const relatorio = useQuery({
    queryKey: ["faturamento-relatorio", empresaId, mes, ano, consolidado],
    queryFn: () => api<Relatorio>(`/api/v1/faturamento/relatorio?${new URLSearchParams(parametros)}`),
    enabled: competencia,
  });

  useEffect(() => {
    const itens = relatorio.data?.data.itens;
    if (!itens || carregada === chave) return;
    setLinhas(linhasDe(itens));
    setEditando(false);
    setAviso("");
    setCarregada(chave);
  }, [relatorio.data, chave, carregada]);

  const visiveis = useMemo(() => linhas.filter((linha) => linha.incluida), [linhas]);
  const comUnidade = consolidado;
  const total = useMemo(() => Math.round(visiveis.reduce((soma, linha) => soma + numero(linha.valorTexto), 0) * 100) / 100, [visiveis]);
  const origem = relatorio.data?.data.itens ?? [];
  const calculado = relatorio.data?.data.calculado;
  const editado = relatorio.data?.data.editado ?? null;
  const alterado = linhas.length !== origem.length || linhas.some((linha, index) => {
    const item = origem[index];
    if (!item) return true;
    return !linha.incluida
      || numero(linha.valorTexto) !== item.valor
      || (linha.nome ?? "") !== (item.nome ?? "")
      || (linha.cargo ?? "") !== (item.cargo ?? "")
      || (linha.modalidade ?? "") !== (item.modalidade ?? "")
      || linha.situacao !== item.situacao
      || (linha.unidade ?? "") !== (item.unidade ?? "");
  });
  const original = calculado?.total ?? relatorio.data?.data.total ?? 0;

  function atualizar(chave: string, patch: Partial<Linha>) {
    setLinhas((atual) => atual.map((linha) => linha.chave === chave ? { ...linha, ...patch } : linha));
  }

  function itensDaTela() {
    return visiveis.map((linha) => ({
      nome: linha.nome?.trim() || null,
      cargo: linha.cargo?.trim() || null,
      modalidade: linha.modalidade?.trim() || null,
      inicio: linha.inicio,
      situacao: linha.situacao.trim() || "Ativo",
      valor: numero(linha.valorTexto),
      ...(consolidado ? { unidade: linha.unidade?.trim() || null } : {}),
    }));
  }

  async function recarregar() {
    // Espera o relatório novo chegar antes de soltar o efeito que remonta as linhas.
    await client.invalidateQueries({ queryKey: ["faturamento-relatorio", empresaId, mes, ano, consolidado] });
    setCarregada("");
    await client.invalidateQueries({ queryKey: ["faturamento"] });
  }

  const salvar = useMutation({
    mutationFn: () => api<{ total: number; linhas: number }>("/api/v1/faturamento/relatorio", {
      method: "PUT",
      body: JSON.stringify({ empresa: empresaId, mes, ano, consolidado, itens: itensDaTela() }),
    }),
    onSuccess: async () => {
      await recarregar();
      setAviso("Relatório salvo. Ainda não foi enviado; vale na lista do faturamento e no envio.");
    },
    onError: (error: Error) => setAviso(error.message),
  });

  const descartar = useMutation({
    mutationFn: () => api(`/api/v1/faturamento/relatorio?${new URLSearchParams(parametros)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await recarregar();
      setAviso("Edição descartada. O relatório voltou ao calculado.");
    },
    onError: (error: Error) => setAviso(error.message),
  });

  function restaurar() {
    if (editado) {
      if (window.confirm("Descartar o relatório salvo e voltar ao calculado?")) descartar.mutate();
      return;
    }
    if (dados) setLinhas(linhasDe(dados.itens));
  }

  const enviar = useMutation({
    mutationFn: () => api<{ enviados: number; falhas: Array<{ motivo: string }> }>("/api/v1/faturamento/relatorios", {
      method: "POST",
      body: JSON.stringify({
        empresas: [empresaId],
        mes,
        ano,
        consolidado,
        itens: itensDaTela(),
      }),
    }),
    onSuccess: async (resposta) => {
      const falha = resposta.data.falhas[0]?.motivo;
      setAviso(resposta.data.enviados > 0
        ? "Relatório enviado com as linhas desta tela."
        : falha || "O relatório não foi enviado.");
      await client.invalidateQueries({ queryKey: ["faturamento"] });
      await client.invalidateQueries({ queryKey: ["cobrancas"] });
      onEnviado?.();
    },
    onError: (error: Error) => setAviso(error.message),
  });

  const dados = relatorio.data?.data;

  function baixar() {
    const competenciaTexto = `${mes.padStart(2, "0")}/${ano}`;
    const corpo = [
      ["Empresa", dados?.empresa ?? ""],
      ["CNPJ", dados?.cnpj ? formatCnpj(dados.cnpj) : ""],
      ["Competência", competenciaTexto],
      ["E-mail", dados?.email ?? ""],
      [],
      [...(comUnidade ? ["Unidade"] : []), "Candidato", "Cargo", "Modalidade", "Início", "Situação", "Valor"],
      ...visiveis.map((linha) => [
        ...(comUnidade ? [linha.unidade ?? ""] : []),
        linha.nome || "Sem nome",
        linha.cargo ?? "",
        linha.modalidade ?? "",
        linha.inicio ? dateBr(linha.inicio) : "",
        linha.situacao,
        numero(linha.valorTexto).toFixed(2).replace(".", ","),
      ]),
      [],
      [...(comUnidade ? [""] : []), "", "", "", "", "Total", total.toFixed(2).replace(".", ",")],
    ];
    const base = (dados?.empresa || "empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "empresa";
    baixarRelatorio(`relatorio-${base}-${mes.padStart(2, "0")}-${ano}.csv`, corpo.map((colunas) => colunas.map(celulaCsv).join(";")).join("\r\n"));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="relatorio-titulo">
      <Card className="motion-pop grid max-h-[90vh] w-full max-w-5xl gap-4 overflow-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="relatorio-titulo" className="text-lg font-bold text-navy-900">{dados?.empresa ? textoPlano(dados.empresa) : "Relatório da empresa"}</h2>
            <p className="text-sm text-slate-500">
              {competencia ? `${mes.padStart(2, "0")}/${ano}${consolidado ? " · consolidado com as unidades" : ""}` : "Sem competência"}
              {dados?.cnpj ? ` · ${formatCnpj(dados.cnpj)}` : ""}
              {dados ? ` · ${dados.email || "Sem e-mail financeiro"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {competencia && !relatorio.isLoading && !relatorio.error ? (
              <Button type="button" variant="secondary" onClick={() => setEditando((atual) => !atual)}>{editando ? <><Eye size={16} /> Pré-visualizar</> : <><Pencil size={16} /> Editar relatório</>}</Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}><X size={16} /> Fechar</Button>
          </div>
        </div>

        {!competencia ? <p className="text-sm text-slate-500">Esta cobrança não é um faturamento mensal. O relatório só abre quando a descrição começa com Faturamento M/AAAA.</p> : null}
        {relatorio.isLoading ? <Skeleton className="h-40" /> : null}
        {relatorio.error instanceof Error ? <Alerta>{relatorio.error.message}</Alerta> : null}

        {competencia && !relatorio.isLoading && linhas.length === 0 && !relatorio.error ? <p className="text-sm text-slate-500">Nenhum candidato entra neste mês. Em "Editar relatório" dá para adicionar uma linha (cobrança retroativa).</p> : null}
        {editado ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Relatório editado e salvo em {quando(editado.atualizado_em)}, ainda não enviado. Calculado pelo sistema: {money(original)} ({calculado?.itens.length ?? 0} {calculado?.itens.length === 1 ? "linha" : "linhas"}).
          </p>
        ) : null}

        {editando ? (
          <div className="grid gap-2">
          <div className="overflow-x-auto">
            <table className="data-table compact min-w-[860px]">
              <thead>
                <tr>
                  <th>Entra</th>
                  {comUnidade ? <th>Unidade</th> : null}
                  <th>Candidato</th>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th>Situação</th>
                  <th className="text-right">Valor</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.chave}>
                    <td>
                      <input className="size-4 accent-cyan-700" aria-label={`Incluir ${linha.nome || "candidato"}`} type="checkbox" checked={linha.incluida} onChange={(event) => atualizar(linha.chave, { incluida: event.target.checked })} />
                    </td>
                    {comUnidade ? <td><Input aria-label="Unidade" value={linha.unidade ?? ""} onChange={(event) => atualizar(linha.chave, { unidade: event.target.value })} /></td> : null}
                    <td><Input aria-label="Candidato" value={linha.nome ?? ""} onChange={(event) => atualizar(linha.chave, { nome: event.target.value })} /></td>
                    <td><Input aria-label="Cargo" value={linha.cargo ?? ""} onChange={(event) => atualizar(linha.chave, { cargo: event.target.value })} /></td>
                    <td><Input aria-label="Modalidade" value={linha.modalidade ?? ""} onChange={(event) => atualizar(linha.chave, { modalidade: event.target.value })} /></td>
                    <td><Input aria-label="Situação" value={linha.situacao} onChange={(event) => atualizar(linha.chave, { situacao: event.target.value })} /></td>
                    <td className="w-36"><Input className="text-right tabular-nums" aria-label="Valor" inputMode="decimal" placeholder="0,00" value={linha.valorTexto} onChange={(event) => atualizar(linha.chave, { valorTexto: event.target.value })} /></td>
                    <td className="w-10">
                      {linha.nova ? (
                        <Button type="button" variant="ghost" aria-label="Remover linha" title="Remover linha" onClick={() => setLinhas((atual) => atual.filter((item) => item.chave !== linha.chave))}><Trash2 size={16} /></Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={() => setLinhas((atual) => [...atual, linhaNova()])}><Plus size={16} /> Adicionar linha</Button>
          </div>
          </div>
        ) : competencia && linhas.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
                  {comUnidade ? <th>Unidade</th> : null}
                  <th>Candidato</th>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th>Início</th>
                  <th>Situação</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((linha) => (
                  <tr key={linha.chave}>
                    {comUnidade ? <td className="text-slate-600">{linha.unidade || "—"}</td> : null}
                    <td className="font-semibold text-navy-900">{linha.nome || "Sem nome"}</td>
                    <td className="text-slate-600">{linha.cargo || "—"}</td>
                    <td className="text-slate-600">{linha.modalidade || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(linha.inicio)}</td>
                    <td className="text-slate-600">{linha.situacao}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(numero(linha.valorTexto))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {competencia && (linhas.length > 0 || editado) ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold text-navy-900"><span className="tabular-nums">Total {money(total)}</span> · {visiveis.length} {visiveis.length === 1 ? "linha" : "linhas"}</p>
              {alterado ? <p className="text-slate-500">{editado ? "Há mudanças não salvas." : `Calculado ${money(original)}.`} "Salvar sem enviar" guarda as linhas para depois; o envio usa as linhas desta tela. Se o boleto do mês já existir, o valor dele não muda.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={visiveis.length === 0} onClick={baixar}><Download size={16} /> Baixar relatório</Button>
              <Button type="button" variant="ghost" disabled={descartar.isPending} onClick={restaurar}><RotateCcw size={16} /> {editado ? "Voltar ao calculado" : "Restaurar"}</Button>
              <Button type="button" variant="secondary" disabled={salvar.isPending || !alterado} onClick={() => salvar.mutate()}><Save size={16} /> {salvar.isPending ? "Salvando…" : "Salvar sem enviar"}</Button>
              <Button type="button" disabled={enviar.isPending || visiveis.length === 0} onClick={() => enviar.mutate()}><Send size={16} /> {enviar.isPending ? "Enviando…" : "Enviar este relatório"}</Button>
            </div>
          </div>
        ) : null}
        {aviso ? (/^(Relatório enviado|Relatório salvo|Edição descartada)/.test(aviso)
          ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{aviso}</p>
          : <Alerta>{aviso}</Alerta>) : null}
      </Card>
    </div>
  );
}
