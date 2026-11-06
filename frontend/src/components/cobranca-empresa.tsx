import { useState } from "react";
import { formatCnpj } from "@/lib/format";

export type ValorEmpresa = {
  id_empresa: string;
  cnpj: string;
  nome: string;
  razao_social: string | null;
  tipo: string | null;
  cadastro: string | null;
  servicos: string[];
  clt_modelo: string;
  clt_valor: string | null;
  clt_taxa: string | null;
  clt_calculo: string | null;
  clt_status: string;
  est_modelo: string;
  est_mensal: string | null;
  est_rs: string | null;
  est_taxa: string | null;
  est_calculo: string | null;
  est_status: string;
  ciclo: string | null;
  fechamento_dia: number | null;
  vencimento_dia: number | null;
  notas: string[];
  alertas: string[];
  documentos: string[];
};

function reais(valor: string | number | null) {
  return Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function resumoClt(v: ValorEmpresa) {
  if (v.clt_status === "ok" && v.clt_modelo === "Percentual") return { valor: `${Number(v.clt_valor)}%`, detalhe: "do salário oferecido, por vaga", ativo: true };
  if (v.clt_status === "ok" && v.clt_modelo === "Valor fixo") return { valor: reais(v.clt_valor), detalhe: "fixo, por vaga contratada", ativo: true };
  if (v.clt_modelo === "Não contratado") return { valor: "Não contratado", detalhe: "sem esse serviço", ativo: false };
  return { valor: v.clt_modelo, detalhe: "conferir: o faturamento usa o cadastro antigo", ativo: false };
}

function resumoEstagio(v: ValorEmpresa) {
  if (v.est_status === "ok" && v.est_mensal != null) {
    const rs = Number(v.est_rs ?? 0);
    return { valor: `${reais(v.est_mensal)}/mês`, detalhe: rs > 0 ? `por estagiário + ${reais(rs)} de R&S no 1º mês` : "por estagiário", ativo: true };
  }
  if (v.est_modelo === "Não contratado") return { valor: "Não contratado", detalhe: "sem esse serviço", ativo: false };
  return { valor: v.est_modelo, detalhe: "conferir: o faturamento usa o cadastro antigo", ativo: false };
}

function Resumo({ titulo, valor, detalhe, ativo }: { titulo: string; valor: string; detalhe: string; ativo: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={ativo ? "text-xl font-extrabold text-orange-500" : "font-semibold text-slate-700"}>{valor}</p>
      <p className="text-sm text-slate-500">{detalhe}</p>
    </div>
  );
}

/** Condições de cobrança do contrato da empresa (tabela valor_empresas), no formato do levantamento de contratos. */
export function CobrancaEmpresa({ valor, aberto: abertoInicial = false, titulo = true }: { valor: ValorEmpresa; aberto?: boolean; titulo?: boolean }) {
  const [aberto, setAberto] = useState(abertoInicial);
  const clt = resumoClt(valor);
  const estagio = resumoEstagio(valor);
  const observacoes = valor.notas.length + valor.alertas.length;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}
        className="grid w-full gap-4 p-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          {titulo ? <p className="font-bold text-navy-900">{valor.nome}</p> : <p className="font-bold text-navy-900">Cobrança do contrato</p>}
          <p className="truncate text-sm text-slate-500">{[valor.razao_social, formatCnpj(valor.cnpj)].filter(Boolean).join(" · ")}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {valor.tipo ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{valor.tipo}</span> : null}
            {valor.vencimento_dia ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-800">Vence dia {valor.vencimento_dia}</span> : null}
            {observacoes ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{observacoes} obs.</span> : null}
            {valor.alertas.length ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Conferir</span> : null}
          </div>
        </div>
        <Resumo titulo="CLT" {...clt} />
        <Resumo titulo="Estágio" {...estagio} />
        <span className="text-lg text-orange-500" aria-hidden>{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto ? (
        <div className="grid gap-5 border-t border-slate-100 p-4 md:grid-cols-3">
          <div className="grid content-start gap-2">
            <h3 className="font-bold text-navy-900">CLT</h3>
            <p className="text-sm text-slate-700">{valor.clt_calculo || "—"}</p>
            {clt.ativo ? <p className="text-xs text-slate-500">Cobrada só no mês em que o contratado começa; garantia de reposição de 45 dias.</p> : null}
          </div>
          <div className="grid content-start gap-2">
            <h3 className="font-bold text-navy-900">Estágio</h3>
            <p className="text-sm text-slate-700">{valor.est_calculo || "—"}</p>
            {valor.ciclo ? <p className="text-xs text-slate-500">{valor.ciclo}.</p> : null}
          </div>
          <div className="grid content-start gap-2">
            <h3 className="font-bold text-navy-900">Observações</h3>
            {observacoes ? (
              <ul className="grid list-disc gap-1.5 pl-5 text-sm text-slate-700">
                {valor.alertas.map((alerta) => <li key={alerta} className="text-amber-700">{alerta}</li>)}
                {valor.notas.map((nota) => <li key={nota}>{nota}</li>)}
              </ul>
            ) : <p className="text-sm text-slate-500">Sem observações.</p>}
            <div className="grid gap-0.5 text-xs text-slate-500">
              <p>{[`CNPJ ${formatCnpj(valor.cnpj)}`, valor.tipo, valor.cadastro ? `cadastro ${valor.cadastro}` : ""].filter(Boolean).join(" · ")}</p>
              {valor.vencimento_dia ? <p>Vencimento do contrato: dia {valor.vencimento_dia}{valor.fechamento_dia ? ` (fechamento dia ${valor.fechamento_dia})` : ""}</p> : null}
              {valor.servicos.length ? <p>Serviços: {valor.servicos.join(", ")}</p> : null}
              {valor.documentos.length ? <p>Contratos em Documentos Gerados: {valor.documentos.join("; ")}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
