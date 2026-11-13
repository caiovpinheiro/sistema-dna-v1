import { useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronDown, ChevronRight, GraduationCap, Loader2, Mail, MapPin, Phone, Plus, Search } from "lucide-react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { LinhaPreview, PreviewFlutuante, useLinhaPreview } from "@/components/preview";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Input, Select, Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone } from "@/lib/format";

type Contrato = { ativo: boolean; cargo: string | null; empresa: string | null; regime: "clt" | "estagio" | "outro"; inicio: string | null };
type Row = {
  id_candidato: string;
  nome: string;
  cpf: string;
  email: string;
  celular: string | null;
  telefonefixo?: string | null;
  cidade: string | null;
  estado: string | null;
  bairro?: string | null;
  datanascimento?: string | null;
  datacadastro?: string | null;
  curso?: string | null;
  nome_escola?: string | null;
  vinculo?: "dna" | "empresa";
  empresa_nome?: string | null;
  contrato?: Contrato | null;
};
type Detail = Row & { telefonefixo: string | null; datanascimento: string | null; curso: string | null; nome_escola: string | null; bairro: string | null };

const CHAVES = ["nome", "cpf", "email", "telefone", "cidade", "uf", "situacao", "regime", "vinculo"] as const;
const CHAVES_EXTRAS = ["email", "cidade", "uf", "situacao", "regime", "vinculo"];

/** Idade em anos a partir da data de nascimento (AAAA-MM-DD). */
export function idadeDe(nascimento: string | null | undefined, hoje = new Date()): number | null {
  const partes = nascimento?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!partes) return null;
  const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  let idade = hoje.getFullYear() - ano;
  if (hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)) idade -= 1;
  return idade > 0 && idade < 120 ? idade : null;
}

function iniciais(nome: string | null | undefined) {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return `${partes[0][0]}${partes.length > 1 ? partes[partes.length - 1][0] : ""}`.toUpperCase();
}

function local(item: Row) {
  const cidade = [item.cidade, item.estado].filter(Boolean).join(" / ");
  return [item.bairro, cidade].filter(Boolean).join(", ");
}

/** Situação de contratação: contratado agora, já foi contratado ou nunca foi. */
function Situacao({ contrato }: { contrato: Contrato | null | undefined }) {
  if (contrato === undefined) return <span className="text-slate-400">—</span>;
  if (!contrato) return <Badge value="encerrada">Sem contratação</Badge>;
  const onde = [contrato.cargo, contrato.empresa].filter(Boolean).join(" em ");
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge value={contrato.ativo ? "ativa" : "fechada"}>{contrato.ativo ? "Contratado" : "Ex-contratado"}</Badge>
        {contrato.regime !== "outro" ? <Badge value={contrato.regime}>{contrato.regime === "clt" ? "CLT" : "Estágio"}</Badge> : null}
      </span>
      {onde ? <span className="truncate text-xs text-slate-600" title={onde}>{contrato.ativo ? "" : "Último: "}{onde}</span> : null}
      {contrato.ativo && contrato.inicio ? <span className="text-xs text-slate-500">desde {dateBr(contrato.inicio)}</span> : null}
    </div>
  );
}

function Origem({ item }: { item: Row }) {
  return item.vinculo === "empresa"
    ? <span className="text-sm text-slate-700" title="Candidato cadastrado por outra empresa">{item.empresa_nome || "Outra empresa"}</span>
    : <span className="text-sm text-slate-700">DNA Work</span>;
}

function Avatar({ nome, ativo }: { nome: string; ativo: boolean }) {
  return (
    <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", ativo ? "bg-emerald-50 text-emerald-800" : "bg-cyan-50 text-cyan-800")}>
      {iniciais(nome)}
    </span>
  );
}

export function CandidatosPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  const result = useQuery({
    queryKey: ["candidatos", query],
    queryFn: () => api<Row[]>(`/api/v1/candidatos?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "20" })}`),
  });
  const preview = useLinhaPreview();
  const detalhe = useQuery({
    queryKey: ["candidato", preview.id],
    queryFn: () => api<Detail>(`/api/v1/candidatos/${preview.id}`),
    enabled: Boolean(preview.id),
    staleTime: 60_000,
  });
  const aberto = result.data?.data.find((item) => item.id_candidato === preview.id);
  const ficha = detalhe.data?.data;
  function pesquisar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of CHAVES) {
      const value = String(data.get(key) ?? "").trim();
      if (value) next.set(key, value);
    }
    // Mesma busca de novo: recarrega a lista (senão o clique não faria nada).
    if (next.toString() === params.toString()) void result.refetch();
    else setParams(next);
  }
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  const lista = result.data;
  const filtrando = CHAVES.some((chave) => params.get(chave));
  const extrasAtivos = CHAVES_EXTRAS.filter((chave) => params.get(chave)).length;
  const total = lista ? Number(lista.meta?.total ?? lista.data.length) : null;

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Candidatos"
        descricao="Todas as pessoas cadastradas, com contato, formação e a contratação atual. Passe o mouse numa linha para ver mais; clique no nome para abrir a ficha."
        acoes={<Link to="/candidatos/novo"><Button><Plus size={16} /> Novo candidato</Button></Link>}
      />

      <Card>
        {/* key: ao limpar os filtros, os campos voltam ao vazio. */}
        <form key={params.toString()} className="grid gap-3" onSubmit={pesquisar}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <CampoFiltro rotulo="Nome" className="sm:col-span-2 lg:col-span-1">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input name="nome" aria-label="Nome" placeholder="Nome do candidato" defaultValue={params.get("nome") ?? ""} className="pl-9" />
              </div>
            </CampoFiltro>
            <CampoFiltro rotulo="CPF">
              <Input name="cpf" aria-label="CPF" inputMode="numeric" placeholder="000.000.000-00" defaultValue={params.get("cpf") ?? ""} />
            </CampoFiltro>
            <CampoFiltro rotulo="Telefone">
              <Input name="telefone" aria-label="Telefone" inputMode="tel" placeholder="DDD + número" defaultValue={params.get("telefone") ?? ""} />
            </CampoFiltro>
            <Button type="submit" className="h-10 sm:col-span-2 lg:col-span-1">{result.isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {result.isFetching ? "Pesquisando…" : "Pesquisar"}</Button>
          </div>
          <details open={extrasAtivos > 0} className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-semibold text-cyan-700 [&::-webkit-details-marker]:hidden">
              <ChevronDown size={15} className="-rotate-90 transition group-open:rotate-0" />
              Mais filtros{extrasAtivos ? ` (${extrasAtivos} em uso)` : ""}
            </summary>
            <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <CampoFiltro rotulo="E-mail">
                <Input name="email" aria-label="E-mail" placeholder="nome@email.com" defaultValue={params.get("email") ?? ""} />
              </CampoFiltro>
              <CampoFiltro rotulo="Cidade">
                <Input name="cidade" aria-label="Cidade" placeholder="Todas" defaultValue={params.get("cidade") ?? ""} />
              </CampoFiltro>
              <CampoFiltro rotulo="UF">
                <Input name="uf" aria-label="UF" placeholder="SP" maxLength={2} defaultValue={params.get("uf") ?? ""} className="uppercase" />
              </CampoFiltro>
              <CampoFiltro rotulo="Contratação">
                <Select name="situacao" aria-label="Situação" defaultValue={params.get("situacao") ?? ""}>
                  <option value="">Todas</option>
                  <option value="ativo">Contratado agora</option>
                  <option value="encerrado">Já foi contratado</option>
                  <option value="sem_vinculo">Nunca contratado</option>
                </Select>
              </CampoFiltro>
              <CampoFiltro rotulo="Regime do contrato">
                <Select name="regime" aria-label="Regime" defaultValue={params.get("regime") ?? ""}>
                  <option value="">Todos</option>
                  <option value="clt">CLT</option>
                  <option value="estagio">Estágio</option>
                </Select>
              </CampoFiltro>
              <CampoFiltro rotulo="Cadastrado por">
                <Select name="vinculo" aria-label="DNA ou outra empresa" defaultValue={params.get("vinculo") ?? ""}>
                  <option value="">Todos</option>
                  <option value="dna">DNA Work</option>
                  <option value="empresa">Outra empresa</option>
                </Select>
              </CampoFiltro>
            </div>
          </details>
        </form>
      </Card>

      <ResumoResultados total={total} singular="candidato" plural="candidatos" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => setParams(new URLSearchParams())} />

      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Não foi possível pesquisar os candidatos. Atualize a página; se continuar, avise o suporte.</p>
      ) : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="p-0">
          {/* Tela larga: tabela. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Candidato</th>
                  <th>Contato</th>
                  <th>Formação</th>
                  <th>Contratação</th>
                  <th>Cadastrado por</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((item) => {
                  const idade = idadeDe(item.datanascimento);
                  const ondeMora = local(item);
                  return (
                    <tr key={item.id_candidato} onMouseEnter={(event) => preview.mostrar(item.id_candidato, event)} onMouseLeave={preview.esconder}>
                      <td className="max-w-80">
                        <div className="flex items-center gap-3">
                          <Avatar nome={item.nome} ativo={Boolean(item.contrato?.ativo)} />
                          <div className="min-w-0">
                            <Link className="block truncate" to={`/candidatos/${item.id_candidato}`}>{item.nome?.trim() || "Sem nome"}</Link>
                            <p className="truncate text-xs text-slate-500">
                              {[formatCpf(item.cpf) || null, idade != null ? `${idade} anos` : null].filter(Boolean).join(", ")}
                            </p>
                            {ondeMora ? <p className="flex items-center gap-1 truncate text-xs text-slate-500"><MapPin size={11} className="shrink-0" /> {ondeMora}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-64">
                        {item.celular ? <p className="flex items-center gap-1.5 whitespace-nowrap tabular-nums text-slate-700"><Phone size={13} className="shrink-0 text-slate-400" /> {formatPhone(item.celular)}</p> : null}
                        {item.email ? <p className="flex items-center gap-1.5 truncate text-xs text-slate-500" title={item.email}><Mail size={12} className="shrink-0 text-slate-400" /> {item.email}</p> : null}
                        {!item.celular && !item.email ? <span className="text-slate-400">—</span> : null}
                      </td>
                      <td className="max-w-56">
                        {item.curso || item.nome_escola ? (
                          <>
                            {item.curso ? <p className="truncate text-slate-700" title={item.curso}>{item.curso}</p> : null}
                            {item.nome_escola ? <p className="truncate text-xs text-slate-500" title={item.nome_escola}>{item.nome_escola}</p> : null}
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="max-w-64"><Situacao contrato={item.contrato} /></td>
                      <td className="max-w-48">
                        <Origem item={item} />
                        {item.datacadastro ? <p className="text-xs text-slate-500">em {dateBr(item.datacadastro)}</p> : null}
                      </td>
                      <td className="w-px whitespace-nowrap text-right">
                        <Link to={`/candidatos/${item.id_candidato}`} aria-label={`Abrir ${item.nome}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Tela estreita: um bloco por candidato, com as mesmas informações. */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {lista.data.map((item) => {
              const idade = idadeDe(item.datanascimento);
              const ondeMora = local(item);
              return (
                <li key={item.id_candidato} className="grid gap-3 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar nome={item.nome} ativo={Boolean(item.contrato?.ativo)} />
                    <div className="min-w-0 flex-1">
                      <Link className="font-semibold text-cyan-800" to={`/candidatos/${item.id_candidato}`}>{item.nome?.trim() || "Sem nome"}</Link>
                      <p className="text-xs text-slate-500">{[formatCpf(item.cpf) || null, idade != null ? `${idade} anos` : null].filter(Boolean).join(", ")}</p>
                    </div>
                  </div>
                  <ul className="grid gap-1 text-sm text-slate-600">
                    {item.celular ? <li className="flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {formatPhone(item.celular)}</li> : null}
                    {item.email ? <li className="flex items-center gap-2 break-all"><Mail size={14} className="shrink-0 text-slate-400" /> {item.email}</li> : null}
                    {ondeMora ? <li className="flex items-center gap-2"><MapPin size={14} className="shrink-0 text-slate-400" /> {ondeMora}</li> : null}
                    {item.curso || item.nome_escola ? <li className="flex items-center gap-2"><GraduationCap size={14} className="shrink-0 text-slate-400" /> {[item.curso, item.nome_escola].filter(Boolean).join(", ")}</li> : null}
                    <li className="flex items-start gap-2"><Briefcase size={14} className="mt-1 shrink-0 text-slate-400" /> <Situacao contrato={item.contrato} /></li>
                  </ul>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
          <PreviewFlutuante box={preview.box}>
            {aberto ? (
              <LinhaPreview
                titulo={aberto.nome}
                linhas={[
                  formatCpf(aberto.cpf),
                  aberto.email,
                  (ficha?.celular ?? aberto.celular) ? formatPhone(ficha?.celular ?? aberto.celular) : null,
                  ficha?.telefonefixo ? formatPhone(ficha.telefonefixo) : null,
                  [ficha?.bairro, aberto.cidade, aberto.estado].filter(Boolean).join(" / ") || null,
                  ficha?.datanascimento ? `Nascimento ${dateBr(ficha.datanascimento)}` : null,
                  [ficha?.curso, ficha?.nome_escola].filter(Boolean).join(" · ") || null,
                ]}
              />
            ) : null}
          </PreviewFlutuante>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhum candidato com esses filtros" text="Confira o nome, CPF ou telefone digitado, ou limpe os filtros para ver todos." />
      ) : <Empty title="Nenhum candidato cadastrado" text="Use “Novo candidato” para cadastrar a primeira pessoa." />}
    </div>
  );
}
