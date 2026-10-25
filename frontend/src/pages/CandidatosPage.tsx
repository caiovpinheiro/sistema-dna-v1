import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LinhaPreview, PreviewFlutuante, useLinhaPreview } from "@/components/preview";
import { Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone } from "@/lib/format";

type Row = { id_candidato: string; nome: string; cpf: string; email: string; celular: string | null; cidade: string | null; estado: string | null };
type Detail = Row & { telefonefixo: string | null; datanascimento: string | null; curso: string | null; nome_escola: string | null; bairro: string | null };

export function CandidatosPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const result = useQuery({
    queryKey: ["candidatos", query],
    queryFn: () => api<Row[]>(`/api/v1/candidatos?${new URLSearchParams({ page: "1", pageSize: "20", ...query })}`),
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
    for (const key of ["nome", "cpf", "email", "telefone", "cidade", "uf", "situacao", "regime"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) next.set(key, value);
    }
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Candidatos</h1><p className="text-sm text-slate-500">Cadastro independente da empresa.</p></div>
        <Link to="/candidatos/novo"><Button>Novo candidato</Button></Link>
      </div>
      <Card>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={pesquisar}>
          <Input name="nome" aria-label="Nome" placeholder="Nome" defaultValue={params.get("nome") ?? ""} />
          <Input name="cpf" aria-label="CPF" placeholder="CPF" defaultValue={params.get("cpf") ?? ""} />
          <Input name="email" aria-label="E-mail" placeholder="E-mail" defaultValue={params.get("email") ?? ""} />
          <Input name="telefone" aria-label="Telefone" placeholder="Telefone" defaultValue={params.get("telefone") ?? ""} />
          <Input name="cidade" aria-label="Cidade" placeholder="Cidade" defaultValue={params.get("cidade") ?? ""} />
          <Input name="uf" aria-label="UF" placeholder="UF" maxLength={2} defaultValue={params.get("uf") ?? ""} />
          <Select name="situacao" aria-label="Situação" defaultValue={params.get("situacao") ?? ""}>
            <option value="">Situação do vínculo</option>
            <option value="ativo">Ativo</option>
            <option value="encerrado">Encerrado</option>
            <option value="sem_vinculo">Sem vínculo</option>
          </Select>
          <Select name="regime" aria-label="Regime" defaultValue={params.get("regime") ?? ""}>
            <option value="">Regime</option>
            <option value="clt">CLT</option>
            <option value="estagio">Estágio</option>
          </Select>
          <Button type="submit" className="md:col-start-4 md:justify-self-end">Pesquisar</Button>
        </form>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao pesquisar candidatos.</p> : result.data?.data.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr className="border-b"><th className="px-4 py-3">Nome</th><th>CPF</th><th>Contato</th><th>Cidade</th></tr></thead>
            <tbody>
              {result.data.data.map((item) => (
                <tr key={item.id_candidato} className="border-b border-slate-100 last:border-0 hover:bg-slate-50" onMouseEnter={(event) => preview.mostrar(item.id_candidato, event)} onMouseLeave={preview.esconder}>
                  <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/candidatos/${item.id_candidato}`}>{item.nome}</Link></td>
                  <td>{formatCpf(item.cpf)}</td>
                  <td>{item.email}<div className="text-slate-500">{formatPhone(item.celular)}</div></td>
                  <td>{[item.cidade, item.estado].filter(Boolean).join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-slate-500">{result.data.meta?.total ?? 0} registros</p>
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
      ) : <Empty title="Nenhum candidato" text="Ajuste a pesquisa ou cadastre um novo." />}
    </div>
  );
}
