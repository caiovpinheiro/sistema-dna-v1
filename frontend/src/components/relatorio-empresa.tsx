import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Pencil, RotateCcw, Send, X } from "lucide-react";
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
};

type Relatorio = {
  empresa: string | null;
  cnpj: string | null;
  email: string | null;
  total: number;
  itens: Item[];
};

type Linha = Item & { chave: string; incluida: boolean; valorTexto: string };

function numero(texto: string) {
  const limpo = texto.trim();
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normal);
  return Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

function linhasDe(itens: Item[]) {
  return itens.map((item, index) => ({
    ...item,
    chave: `${index}-${item.nome ?? ""}-${item.inicio ?? ""}`,
    incluida: true,
    valorTexto: item.valor.toFixed(2).replace(".", ","),
  }));
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
  onClose,
  onEnviado,
}: {
  empresaId: string;
  mes: string;
  ano: string;
  onClose: () => void;
  onEnviado?: () => void;
}) {
  const client = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [aviso, setAviso] = useState("");
  const [carregada, setCarregada] = useState("");
  const competencia = Boolean(mes && ano);
  const chave = `${empresaId}|${mes}|${ano}`;
  const relatorio = useQuery({
    queryKey: ["faturamento-relatorio", empresaId, mes, ano],
    queryFn: () => api<Relatorio>(`/api/v1/faturamento/relatorio?${new URLSearchParams({ empresa: empresaId, mes, ano })}`),
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
  const total = useMemo(() => Math.round(visiveis.reduce((soma, linha) => soma + numero(linha.valorTexto), 0) * 100) / 100, [visiveis]);
  const origem = relatorio.data?.data.itens ?? [];
  const alterado = linhas.length !== origem.length || linhas.some((linha, index) => {
    const item = origem[index];
    if (!item) return true;
    return !linha.incluida
      || numero(linha.valorTexto) !== item.valor
      || (linha.nome ?? "") !== (item.nome ?? "")
      || (linha.cargo ?? "") !== (item.cargo ?? "")
      || (linha.modalidade ?? "") !== (item.modalidade ?? "")
      || linha.situacao !== item.situacao;
  });
  const original = relatorio.data?.data.total ?? 0;

  function atualizar(chave: string, patch: Partial<Linha>) {
    setLinhas((atual) => atual.map((linha) => linha.chave === chave ? { ...linha, ...patch } : linha));
  }

  const enviar = useMutation({
    mutationFn: () => api<{ enviados: number; falhas: Array<{ motivo: string }> }>("/api/v1/faturamento/relatorios", {
      method: "POST",
      body: JSON.stringify({
        empresas: [empresaId],
        mes,
        ano,
        itens: visiveis.map((linha) => ({
          nome: linha.nome,
          cargo: linha.cargo,
          modalidade: linha.modalidade,
          situacao: linha.situacao.trim() || "Ativo",
          valor: numero(linha.valorTexto),
        })),
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
      ["Candidato", "Cargo", "Modalidade", "Início", "Situação", "Valor"],
      ...visiveis.map((linha) => [
        linha.nome || "Sem nome",
        linha.cargo ?? "",
        linha.modalidade ?? "",
        linha.inicio ? dateBr(linha.inicio) : "",
        linha.situacao,
        numero(linha.valorTexto).toFixed(2).replace(".", ","),
      ]),
      [],
      ["", "", "", "", "Total", total.toFixed(2).replace(".", ",")],
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
              {competencia ? `${mes.padStart(2, "0")}/${ano}` : "Sem competência"}
              {dados?.cnpj ? ` · ${formatCnpj(dados.cnpj)}` : ""}
              {dados ? ` · ${dados.email || "Sem e-mail financeiro"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {competencia && !relatorio.isLoading && linhas.length > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setEditando((atual) => !atual)}>{editando ? <><Eye size={16} /> Pré-visualizar</> : <><Pencil size={16} /> Editar relatório</>}</Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}><X size={16} /> Fechar</Button>
          </div>
        </div>

        {!competencia ? <p className="text-sm text-slate-500">Esta cobrança não é um faturamento mensal. O relatório só abre quando a descrição é Faturamento M/AAAA.</p> : null}
        {relatorio.isLoading ? <Skeleton className="h-40" /> : null}
        {relatorio.error instanceof Error ? <Alerta>{relatorio.error.message}</Alerta> : null}

        {competencia && !relatorio.isLoading && linhas.length === 0 && !relatorio.error ? <p className="text-sm text-slate-500">Nenhum candidato entra neste mês.</p> : null}

        {editando ? (
          <div className="overflow-x-auto">
            <table className="data-table compact min-w-[860px]">
              <thead>
                <tr>
                  <th>Entra</th>
                  <th>Candidato</th>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th>Situação</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.chave}>
                    <td>
                      <input className="size-4 accent-cyan-700" aria-label={`Incluir ${linha.nome || "candidato"}`} type="checkbox" checked={linha.incluida} onChange={(event) => atualizar(linha.chave, { incluida: event.target.checked })} />
                    </td>
                    <td><Input aria-label="Candidato" value={linha.nome ?? ""} onChange={(event) => atualizar(linha.chave, { nome: event.target.value })} /></td>
                    <td><Input aria-label="Cargo" value={linha.cargo ?? ""} onChange={(event) => atualizar(linha.chave, { cargo: event.target.value })} /></td>
                    <td><Input aria-label="Modalidade" value={linha.modalidade ?? ""} onChange={(event) => atualizar(linha.chave, { modalidade: event.target.value })} /></td>
                    <td><Input aria-label="Situação" value={linha.situacao} onChange={(event) => atualizar(linha.chave, { situacao: event.target.value })} /></td>
                    <td className="w-36"><Input className="text-right tabular-nums" aria-label="Valor" inputMode="decimal" value={linha.valorTexto} onChange={(event) => atualizar(linha.chave, { valorTexto: event.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : competencia && linhas.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table min-w-[720px]">
              <thead>
                <tr>
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

        {competencia && linhas.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold text-navy-900"><span className="tabular-nums">Total {money(total)}</span> · {visiveis.length} {visiveis.length === 1 ? "linha" : "linhas"}</p>
              {alterado ? <p className="text-slate-500">Calculado {money(original)}. A edição vale para este envio. Se o boleto do mês já existir, o valor dele não muda.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={visiveis.length === 0} onClick={baixar}><Download size={16} /> Baixar relatório</Button>
              <Button type="button" variant="ghost" onClick={() => dados && setLinhas(linhasDe(dados.itens))}><RotateCcw size={16} /> Restaurar</Button>
              <Button type="button" disabled={enviar.isPending || visiveis.length === 0} onClick={() => enviar.mutate()}><Send size={16} /> {enviar.isPending ? "Enviando…" : "Enviar este relatório"}</Button>
            </div>
          </div>
        ) : null}
        {aviso ? (aviso.startsWith("Relatório enviado")
          ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{aviso}</p>
          : <Alerta>{aviso}</Alerta>) : null}
      </Card>
    </div>
  );
}
