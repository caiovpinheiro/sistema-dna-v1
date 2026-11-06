import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, money } from "@/lib/format";

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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="relatorio-titulo">
      <Card className="motion-pop grid max-h-[90vh] w-full max-w-5xl gap-4 overflow-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="relatorio-titulo" className="text-lg font-bold">{dados?.empresa || "Relatório da empresa"}</h2>
            <p className="text-sm text-slate-500">
              {competencia ? `${mes.padStart(2, "0")}/${ano}` : "Sem competência"}
              {dados?.cnpj ? ` · ${formatCnpj(dados.cnpj)}` : ""}
              {dados ? ` · ${dados.email || "Sem e-mail financeiro"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {competencia && !relatorio.isLoading && linhas.length > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setEditando((atual) => !atual)}>{editando ? "Pré-visualizar" : "Editar relatório"}</Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        </div>

        {!competencia ? <p className="text-sm text-slate-500">Esta cobrança não é um faturamento mensal. O relatório só abre quando a descrição é Faturamento M/AAAA.</p> : null}
        {relatorio.isLoading ? <p className="text-sm text-slate-500">Carregando relatório...</p> : null}
        {relatorio.error instanceof Error ? <p className="text-sm text-rose-600">{relatorio.error.message}</p> : null}

        {competencia && !relatorio.isLoading && linhas.length === 0 && !relatorio.error ? <p className="text-sm text-slate-500">Nenhum candidato entra neste mês.</p> : null}

        {editando ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-2">Entra</th>
                  <th className="px-2 py-2">Candidato</th>
                  <th className="px-2 py-2">Cargo</th>
                  <th className="px-2 py-2">Modalidade</th>
                  <th className="px-2 py-2">Situação</th>
                  <th className="px-2 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.chave} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <input aria-label={`Incluir ${linha.nome || "candidato"}`} type="checkbox" checked={linha.incluida} onChange={(event) => atualizar(linha.chave, { incluida: event.target.checked })} />
                    </td>
                    <td className="px-2 py-2"><Input aria-label="Candidato" value={linha.nome ?? ""} onChange={(event) => atualizar(linha.chave, { nome: event.target.value })} /></td>
                    <td className="px-2 py-2"><Input aria-label="Cargo" value={linha.cargo ?? ""} onChange={(event) => atualizar(linha.chave, { cargo: event.target.value })} /></td>
                    <td className="px-2 py-2"><Input aria-label="Modalidade" value={linha.modalidade ?? ""} onChange={(event) => atualizar(linha.chave, { modalidade: event.target.value })} /></td>
                    <td className="px-2 py-2"><Input aria-label="Situação" value={linha.situacao} onChange={(event) => atualizar(linha.chave, { situacao: event.target.value })} /></td>
                    <td className="px-2 py-2"><Input aria-label="Valor" inputMode="decimal" value={linha.valorTexto} onChange={(event) => atualizar(linha.chave, { valorTexto: event.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : competencia && linhas.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Candidato</th>
                  <th className="px-3 py-2">Cargo</th>
                  <th className="px-3 py-2">Modalidade</th>
                  <th className="px-3 py-2">Início</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((linha) => (
                  <tr key={linha.chave} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{linha.nome || "Sem nome"}</td>
                    <td className="px-3 py-2">{linha.cargo}</td>
                    <td className="px-3 py-2">{linha.modalidade}</td>
                    <td className="px-3 py-2">{dateBr(linha.inicio)}</td>
                    <td className="px-3 py-2">{linha.situacao}</td>
                    <td className="px-3 py-2">{money(numero(linha.valorTexto))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {competencia && linhas.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold">Total {money(total)} · {visiveis.length} {visiveis.length === 1 ? "linha" : "linhas"}</p>
              {alterado ? <p className="text-slate-500">Calculado {money(original)}. A edição vale para este envio. Se o boleto do mês já existir, o valor dele não muda.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => dados && setLinhas(linhasDe(dados.itens))}>Restaurar</Button>
              <Button type="button" disabled={enviar.isPending || visiveis.length === 0} onClick={() => enviar.mutate()}>{enviar.isPending ? "Enviando..." : "Enviar este relatório"}</Button>
            </div>
          </div>
        ) : null}
        {aviso ? <p className={`text-sm font-semibold ${aviso.startsWith("Relatório enviado") ? "text-emerald-700" : "text-rose-600"}`}>{aviso}</p> : null}
      </Card>
    </div>
  );
}
