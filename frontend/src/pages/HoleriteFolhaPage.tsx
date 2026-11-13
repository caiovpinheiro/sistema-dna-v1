import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Card, Empty, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, money } from "@/lib/format";

type Lancamento = { faltas: number; auxilio_transporte: number; acrescimos: number; descricao_acrescimos: string; descontos: number; descricao_descontos: string };
type Calculo = { dias_mes: number; dias_trabalhados: number; bolsa_base: number; bolsa_proporcional: number; valor_faltas: number; proventos: number; total_descontos: number; liquido: number };
type Item = { id_contratacao: number; nome: string; cpf: string; cargo: string; inicio: string | null; demissao: string | null; lancamento: Lancamento; calculo: Calculo; salvo_em: string | null; salvo_por: string | null };
type Folha = { competencia: string; empresa: { id_empresa: string; razao_social: string; nome_fantasia: string; cnpj: string }; itens: Item[]; fora_do_estagio: number; total_liquido: number };

/** Campos como o operador digita (texto), para aceitar "220,50" sem brigar com o cursor. */
type Rascunho = { faltas: string; auxilio_transporte: string; acrescimos: string; descricao_acrescimos: string; descontos: string; descricao_descontos: string };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function competenciaAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function porExtenso(competencia: string) {
  const [ano, mes] = competencia.split("-").map(Number);
  return mes ? `${MESES[mes - 1]} de ${ano}` : competencia;
}

function numero(texto: string) {
  const limpo = texto.replace(/[^\d.,]/g, "");
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function paraTexto(valor: number) {
  return valor ? String(valor).replace(".", ",") : "";
}

function rascunhoDe(item: Item): Rascunho {
  const l = item.lancamento;
  return { faltas: l.faltas ? String(l.faltas) : "", auxilio_transporte: paraTexto(l.auxilio_transporte), acrescimos: paraTexto(l.acrescimos), descricao_acrescimos: l.descricao_acrescimos, descontos: paraTexto(l.descontos), descricao_descontos: l.descricao_descontos };
}

function lancamentoDe(r: Rascunho): Lancamento {
  return { faltas: Math.floor(numero(r.faltas)), auxilio_transporte: numero(r.auxilio_transporte), acrescimos: numero(r.acrescimos), descricao_acrescimos: r.descricao_acrescimos.trim(), descontos: numero(r.descontos), descricao_descontos: r.descricao_descontos.trim() };
}

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/** Mesma conta do backend (lib/holerite.ts), para o líquido mudar enquanto digita. */
function liquidoDe(calculo: Calculo, l: Lancamento) {
  const diaria = calculo.bolsa_base / calculo.dias_mes;
  const faltas = Math.min(l.faltas, calculo.dias_trabalhados);
  return centavos(calculo.bolsa_proporcional + l.auxilio_transporte + l.acrescimos - centavos(diaria * faltas) - l.descontos);
}

export function HoleriteFolhaPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const competencia = /^\d{4}-\d{2}$/.test(params.get("competencia") ?? "") ? params.get("competencia")! : competenciaAtual();
  const client = useQueryClient();
  const [rascunhos, setRascunhos] = useState<Record<number, Rascunho>>({});
  const [aviso, setAviso] = useState("");
  const folha = useQuery({
    queryKey: ["holerite-folha", id, competencia],
    queryFn: () => api<Folha>(`/api/v1/holerite/empresas/${encodeURIComponent(id)}?competencia=${competencia}`),
  });
  const dados = folha.data?.data;
  useEffect(() => {
    if (dados) setRascunhos(Object.fromEntries(dados.itens.map((item) => [item.id_contratacao, rascunhoDe(item)])));
  }, [dados]);

  const alterados = useMemo(() => (dados?.itens ?? []).filter((item) => {
    const r = rascunhos[item.id_contratacao];
    return r && JSON.stringify(lancamentoDe(r)) !== JSON.stringify(lancamentoDe(rascunhoDe(item)));
  }).map((item) => item.id_contratacao), [dados, rascunhos]);
  const totalLiquido = centavos((dados?.itens ?? []).reduce((soma, item) => soma + liquidoDe(item.calculo, lancamentoDe(rascunhos[item.id_contratacao] ?? rascunhoDe(item))), 0));

  const salvar = useMutation({
    mutationFn: () => api<Folha>(`/api/v1/holerite/empresas/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ competencia, itens: (dados?.itens ?? []).map((item) => ({ id_contratacao: item.id_contratacao, ...lancamentoDe(rascunhos[item.id_contratacao] ?? rascunhoDe(item)) })) }),
    }),
    onSuccess: (resposta) => {
      client.setQueryData(["holerite-folha", id, competencia], resposta);
      setAviso("Folha salva.");
    },
    onError: () => setAviso(""),
  });

  /** Salva o que mudou e abre o PDF (de todos ou de um estagiário) numa aba nova. */
  async function abrirPdf(idContratacao?: number) {
    const aba = window.open("about:blank", "_blank");
    try {
      if (alterados.length) await salvar.mutateAsync();
      const url = `/api/v1/holerite/empresas/${encodeURIComponent(id)}/pdf?competencia=${competencia}${idContratacao ? `&contratacao=${idContratacao}` : ""}`;
      if (aba) aba.location.href = url;
      else window.location.assign(url);
    } catch {
      aba?.close();
    }
  }

  function mudar(idContratacao: number, campo: keyof Rascunho, valor: string) {
    setAviso("");
    setRascunhos((atual) => ({ ...atual, [idContratacao]: { ...(atual[idContratacao] as Rascunho), [campo]: valor } }));
  }

  const nomeEmpresa = dados ? dados.empresa.nome_fantasia || dados.empresa.razao_social : "";
  return (
    <div className="grid gap-5">
      <Link to="/financeiro/holerite" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900"><ArrowLeft size={16} /> Holerite</Link>
      <CabecalhoPagina
        titulo={nomeEmpresa ? `Folha de ${nomeEmpresa}` : "Folha de holerite"}
        descricao={dados ? `Holerites de estágio de ${porExtenso(competencia)}${dados.empresa.cnpj ? `, CNPJ ${dados.empresa.cnpj}` : ""}. Lance faltas, auxílio-transporte, acréscimos e descontos, salve e gere os PDFs.` : "Holerites de estágio da empresa no mês."}
        acoes={(
          <>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              Mês
              <Input type="month" aria-label="Competência" className="w-44" value={competencia} onChange={(event) => { if (event.target.value) setParams({ competencia: event.target.value }); }} />
            </label>
            <Button type="button" variant="secondary" disabled={!dados?.itens.length || salvar.isPending} onClick={() => void abrirPdf()}><FileDown size={16} /> Gerar PDF de todos</Button>
          </>
        )}
      />

      {dados && dados.fora_do_estagio > 0 ? (
        <Alerta tom="info">{dados.fora_do_estagio} {dados.fora_do_estagio === 1 ? "contratado CLT não entra" : "contratados CLT não entram"} nesta folha: o holerite CLT (INSS, IRRF, FGTS) ainda não está no sistema novo.</Alerta>
      ) : null}
      {folha.isError ? <Alerta>{folha.error instanceof ApiError ? folha.error.message : "Não foi possível carregar a folha."}</Alerta> : null}
      {salvar.isError ? <Alerta>{salvar.error instanceof ApiError ? salvar.error.message : "Não foi possível salvar a folha."}</Alerta> : null}
      {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}

      {folha.isLoading ? <Skeleton className="h-72" /> : dados && dados.itens.length === 0 ? (
        <Empty title="Nenhum estagiário ativo neste mês" text="Esta empresa não tem contratação de estágio ativa no mês escolhido. Troque o mês acima." />
      ) : dados ? (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="data-table min-w-[1180px]">
              <thead>
                <tr>
                  <th>Estagiário</th>
                  <th>Dias no mês</th>
                  <th className="text-right">Bolsa</th>
                  <th className="w-24">Faltas (dias)</th>
                  <th className="w-32">Auxílio-transporte</th>
                  <th className="w-56">Outros acréscimos</th>
                  <th className="w-56">Outros descontos</th>
                  <th className="text-right">Líquido</th>
                  <th><span className="sr-only">PDF</span></th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((item) => {
                  const r = rascunhos[item.id_contratacao] ?? rascunhoDe(item);
                  const liquido = liquidoDe(item.calculo, lancamentoDe(r));
                  const mudou = alterados.includes(item.id_contratacao);
                  return (
                    <tr key={item.id_contratacao} className={mudou ? "bg-amber-50" : undefined}>
                      <td className="min-w-52">
                        <p className="font-semibold text-navy-900">{item.nome}</p>
                        <p className="text-xs text-slate-500">{[item.cpf, item.cargo].filter(Boolean).join(", ")}</p>
                      </td>
                      <td className="whitespace-nowrap">
                        <p className="tabular-nums text-slate-700">{item.calculo.dias_trabalhados} de {item.calculo.dias_mes}</p>
                        <p className="text-xs text-slate-500">
                          {item.demissao && item.demissao.slice(0, 7) === competencia ? `saiu ${dateBr(item.demissao)}` : item.inicio && item.inicio.slice(0, 7) === competencia ? `entrou ${dateBr(item.inicio)}` : "mês cheio"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <p className="font-semibold tabular-nums text-navy-900">{money(item.calculo.bolsa_proporcional)}</p>
                        {item.calculo.bolsa_proporcional !== item.calculo.bolsa_base ? <p className="text-xs tabular-nums text-slate-500">de {money(item.calculo.bolsa_base)}</p> : null}
                      </td>
                      <td><Input inputMode="numeric" aria-label={`Faltas de ${item.nome}`} placeholder="0" value={r.faltas} onChange={(event) => mudar(item.id_contratacao, "faltas", event.target.value.replace(/\D/g, "").slice(0, 2))} /></td>
                      <td><Input inputMode="decimal" aria-label={`Auxílio-transporte de ${item.nome}`} placeholder="0,00" value={r.auxilio_transporte} onChange={(event) => mudar(item.id_contratacao, "auxilio_transporte", event.target.value)} /></td>
                      <td>
                        <div className="grid gap-1.5">
                          <Input inputMode="decimal" aria-label={`Valor de outros acréscimos de ${item.nome}`} placeholder="0,00" value={r.acrescimos} onChange={(event) => mudar(item.id_contratacao, "acrescimos", event.target.value)} />
                          <Input aria-label={`Descrição dos acréscimos de ${item.nome}`} placeholder="Descrição (ex.: reembolso)" value={r.descricao_acrescimos} onChange={(event) => mudar(item.id_contratacao, "descricao_acrescimos", event.target.value)} />
                        </div>
                      </td>
                      <td>
                        <div className="grid gap-1.5">
                          <Input inputMode="decimal" aria-label={`Valor de outros descontos de ${item.nome}`} placeholder="0,00" value={r.descontos} onChange={(event) => mudar(item.id_contratacao, "descontos", event.target.value)} />
                          <Input aria-label={`Descrição dos descontos de ${item.nome}`} placeholder="Descrição (ex.: adiantamento)" value={r.descricao_descontos} onChange={(event) => mudar(item.id_contratacao, "descricao_descontos", event.target.value)} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right text-base font-extrabold tabular-nums text-navy-900">{money(liquido)}</td>
                      <td className="w-px whitespace-nowrap">
                        <button type="button" className="acao acao-cyan inline-flex items-center gap-1" disabled={salvar.isPending} onClick={() => void abrirPdf(item.id_contratacao)}><FileDown size={13} /> PDF</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_-2px_8px_rgb(15_23_42/0.06)]">
            <p className="text-sm text-slate-600">
              {dados.itens.length} {dados.itens.length === 1 ? "estagiário" : "estagiários"}, líquido total <span className="text-base font-extrabold tabular-nums text-navy-900">{money(totalLiquido)}</span>
              {alterados.length ? <span className="ml-2 font-semibold text-amber-800">{alterados.length} {alterados.length === 1 ? "alteração não salva" : "alterações não salvas"}</span> : null}
            </p>
            <Button type="button" disabled={salvar.isPending || !alterados.length} onClick={() => salvar.mutate()}>
              {salvar.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {salvar.isPending ? "Salvando…" : "Salvar folha"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">Bolsa proporcional = bolsa da vaga ÷ dias do mês × dias contratado no mês; cada falta desconta um dia de bolsa. Estágio não tem INSS, IRRF nem FGTS. Gerar o PDF salva antes o que estiver alterado.</p>
        </>
      ) : null}
    </div>
  );
}
