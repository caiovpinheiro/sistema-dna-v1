import { useQuery } from "@tanstack/react-query";
import { BuscaOpcao } from "@/components/busca-opcao";
import { api } from "@/lib/api";
import { formatCnpj } from "@/lib/format";

export type Pagadora = { id: string; nome: string; razao_social: string | null; cnpj: string; grupo_id: string | null; mesmo_grupo?: boolean };

/**
 * Campo "Cobrar pelo CNPJ de": escolhe a empresa que paga por esta (o boleto sai no CNPJ dela e a
 * cobrança fica igual à dela). A lista traz só empresas com CNPJ que já são faturadas por elas mesmas,
 * as do mesmo grupo primeiro. Vazio = a própria empresa é cobrada (precisa ter CNPJ).
 */
export function EscolherPagadora({ value, onChange, grupoId, excluir }: {
  value: string;
  onChange: (id: string) => void;
  grupoId?: string;
  /** A própria empresa, na edição: não pode pagar por ela mesma. */
  excluir?: string;
}) {
  const filtro = new URLSearchParams();
  if (grupoId) filtro.set("grupo", grupoId);
  if (excluir) filtro.set("excluir", excluir);
  const pagadoras = useQuery({
    queryKey: ["empresas-pagadoras", grupoId ?? "", excluir ?? ""],
    queryFn: () => api<Pagadora[]>(`/api/v1/empresas/pagadoras?${filtro}`),
    staleTime: 60_000,
  });
  const opcoes = (pagadoras.data?.data ?? []).map((empresa) => ({
    id: empresa.id,
    label: `${empresa.nome} · ${formatCnpj(empresa.cnpj)}`,
    // O CNPJ só com números entra para a busca achar "24753523" também.
    detalhe: [empresa.razao_social, empresa.mesmo_grupo ? "mesmo grupo" : null, empresa.cnpj.replace(/\D/g, "")].filter(Boolean).join(" · "),
  }));
  return (
    <BuscaOpcao
      value={value}
      onChange={onChange}
      opcoes={opcoes}
      placeholder={pagadoras.isLoading ? "Carregando empresas…" : "Pesquisar empresa pelo nome ou CNPJ"}
      ariaLabel="Cobrar pelo CNPJ de"
    />
  );
}
