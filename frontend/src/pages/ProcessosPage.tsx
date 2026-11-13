import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Alerta, CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, etapaLabel, origemLabel, textoPlano } from "@/lib/format";

type Row = {
  id: string;
  candidato_nome: string | null;
  empresa_nome: string | null;
  cargo: string | null;
  origem: string;
  etapa: string;
  data_recebimento: string;
  data_encaminhamento: string | null;
};

const FILTROS = ["nome", "origem", "etapa"];

export function ProcessosPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  // Muda só ao limpar: os campos (com defaultValue) voltam ao vazio.
  const [limpeza, setLimpeza] = useState(0);
  const result = useQuery({
    queryKey: ["processos", query],
    queryFn: () => api<Row[]>(`/api/v1/processos?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "30" })}`),
  });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  const lista = result.data;
  const filtrando = FILTROS.some((chave) => params.get(chave));
  const total = lista ? Number(lista.meta?.total ?? lista.data.length) : null;
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Processos"
        descricao="Cada processo liga um candidato a uma vaga e diz quem o trouxe: captado pela DNAWORK (pelo atendimento) ou enviado pela empresa."
        acoes={<Link to="/processos/novo"><Button><Plus size={16} /> Novo processo</Button></Link>}
      />
      <Card key={limpeza} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <CampoFiltro rotulo="Candidato" className="sm:col-span-2 lg:col-span-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Nome do candidato"
              placeholder="Nome do candidato"
              defaultValue={params.get("nome") ?? ""}
              className="pl-9"
              onBlur={(event) => { if (event.target.value.trim() !== (params.get("nome") ?? "")) update("nome", event.target.value.trim()); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          </div>
        </CampoFiltro>
        <CampoFiltro rotulo="Origem">
          <Select aria-label="Origem" defaultValue={params.get("origem") ?? ""} onChange={(event) => update("origem", event.target.value)}>
            <option value="">Todas</option>
            <option value="dnawork">Captado pela DNAWORK</option>
            <option value="empresa">Enviado pela empresa</option>
          </Select>
        </CampoFiltro>
        <CampoFiltro rotulo="Etapa">
          <Select aria-label="Etapa" defaultValue={params.get("etapa") ?? ""} onChange={(event) => update("etapa", event.target.value)}>
            <option value="">Todas</option>
            {Object.entries(etapaLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </CampoFiltro>
      </Card>
      <ResumoResultados total={total} singular="processo" plural="processos" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => { setParams(new URLSearchParams()); setLimpeza((valor) => valor + 1); }} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>Não foi possível carregar os processos. Atualize a página; se continuar, avise o suporte.</Alerta>
      ) : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="p-0">
          <Lista linhas={lista.data} />
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={30} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhum processo com esses filtros" text="Confira o nome digitado ou troque a origem e a etapa; ou limpe os filtros para ver todos." />
      ) : <Empty title="Nenhum processo aberto ainda" text="Use “Novo processo” para ligar um candidato a uma vaga." />}
    </div>
  );
}

export function ProcessosRelacionados({ filtro }: { filtro: string }) {
  const result = useQuery({
    queryKey: ["processos", filtro],
    queryFn: () => api<Row[]>(`/api/v1/processos?page=1&pageSize=20&${filtro}`),
  });
  return (
    <section className="grid gap-3">
      <h2 className="text-[15px] font-bold text-navy-900">Processos seletivos</h2>
      {result.isLoading ? <Skeleton className="h-16" /> : null}
      {result.isError ? <Alerta>Não foi possível carregar os processos.</Alerta> : null}
      {result.data ? (
        result.data.data.length ? (
          <Card className="p-0"><Lista linhas={result.data.data} /></Card>
        ) : <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">Nenhum processo seletivo registrado.</p>
      ) : null}
    </section>
  );
}

/** Cor do selo da etapa: em andamento em ciano/azul, contratado em verde, reprovado em rosa, desistente em cinza. */
const ETAPA_BADGE: Record<string, string> = {
  recebido: "",
  encaminhado: "aberta",
  entrevista_agendada: "preenchida",
  entrevista_realizada: "preenchida",
  contratado: "ativa",
  reprovado: "recusado",
  desistente: "encerrada",
};

export function EtapaBadge({ etapa }: { etapa: string }) {
  return <Badge value={ETAPA_BADGE[etapa] ?? ""}>{etapaLabel[etapa] ?? etapa}</Badge>;
}

function Lista({ linhas }: { linhas: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Candidato</th>
            <th>Empresa</th>
            <th>Vaga</th>
            <th>Origem</th>
            <th>Etapa</th>
            <th>Recebido</th>
            <th>Encaminhado</th>
            <th><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((item) => (
            <tr key={item.id}>
              <td className="max-w-64"><Link className="block truncate" to={`/processos/${item.id}`}>{textoPlano(item.candidato_nome) || "Sem nome"}</Link></td>
              <td className="max-w-56"><p className="truncate text-slate-700">{textoPlano(item.empresa_nome) || "—"}</p></td>
              <td className="max-w-56"><p className="truncate text-slate-700">{textoPlano(item.cargo) || "—"}</p></td>
              <td className="whitespace-nowrap"><Badge value={item.origem === "dnawork" ? "aberta" : ""}>{origemLabel[item.origem] ?? item.origem}</Badge></td>
              <td className="whitespace-nowrap"><EtapaBadge etapa={item.etapa} /></td>
              <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_recebimento)}</td>
              <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_encaminhamento)}</td>
              <td className="w-px whitespace-nowrap text-right">
                <Link to={`/processos/${item.id}`} aria-label={`Abrir processo de ${textoPlano(item.candidato_nome) || "candidato"}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
                  Abrir <ChevronRight size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
