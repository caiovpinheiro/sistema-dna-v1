import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone } from "@/lib/format";

type Documento = {
  id: string;
  tipo: string;
  valor: string | null;
  dados: Record<string, string> | null;
  arquivo_nome: string | null;
  tem_arquivo: boolean;
  origem: string;
  atualizado_em: string;
};

const TIPOS: Array<{ tipo: string; nome: string }> = [
  { tipo: "cpf", nome: "CPF" },
  { tipo: "rg", nome: "RG" },
  { tipo: "nascimento", nome: "Data de nascimento" },
  { tipo: "endereco", nome: "Comprovante de endereço" },
  { tipo: "matricula", nome: "Matrícula escolar" },
  { tipo: "responsavel", nome: "Responsável legal" },
];

const ROTULO_RESPONSAVEL: Record<string, string> = {
  nome: "Nome", nascimento: "Nascimento", cpf: "CPF", rg: "RG", email: "E-mail", telefone: "Telefone",
  endereco: "Endereço", cep: "CEP", cidade: "Cidade", estado: "Estado",
};

const ORDEM_RESPONSAVEL = ["nascimento", "cpf", "rg", "email", "telefone", "endereco", "cep", "cidade", "estado"];

/** Data "2008-05-10" em "10/05/2008"; CEP "11320160" em "11320-160"; o resto como veio. */
function legivel(chave: string, valor: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return dateBr(valor);
  if (chave === "cpf" && valor.replace(/\D/g, "").length === 11) return formatCpf(valor);
  if (chave === "cep") return valor.replace(/^(\d{5})-?(\d{3})$/, "$1-$2");
  if (chave === "telefone") return formatPhone(valor);
  return valor;
}

function valorDoDocumento(tipo: string, valor: string) {
  if (tipo === "endereco") return valor.replace(/CEP (\d{5})-?(\d{3})/, "CEP $1-$2");
  return legivel(tipo, valor);
}

/** Documentos do candidato: os dados que vieram do TCE e os arquivos guardados (inclusive os copiados do sistema antigo). */
export function DocumentosCandidato({ idCandidato }: { idCandidato: string }) {
  const docs = useQuery({
    queryKey: ["candidato-documentos", idCandidato],
    queryFn: () => api<Documento[]>(`/api/v1/candidatos/${idCandidato}/documentos`),
  });
  const porTipo = new Map((docs.data?.data ?? []).map((doc) => [doc.tipo, doc]));
  return (
    <Card>
      <h2 className="mb-1 font-bold">Documentos do candidato</h2>
      <p className="mb-3 text-sm text-slate-500">Gravados quando o TCE é gerado ou editado, e os arquivos que o sistema antigo já tinha.</p>
      {docs.isLoading ? <Skeleton className="h-24" /> : docs.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os documentos.</p> : (
        <div className="grid gap-2">
          {TIPOS.map(({ tipo, nome }) => {
            const doc = porTipo.get(tipo);
            const detalhes = doc?.dados && tipo === "responsavel"
              ? ORDEM_RESPONSAVEL.filter((chave) => doc.dados?.[chave]).map((chave) => `${ROTULO_RESPONSAVEL[chave] ?? chave}: ${legivel(chave, doc.dados![chave])}`)
              : [];
            return (
              <div key={tipo} className="grid gap-1 rounded-xl border border-slate-100 px-3 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-sm font-semibold">{nome}</span>
                <span className="min-w-0 text-sm">
                  {doc?.valor ? <span className="block break-words">{valorDoDocumento(tipo, doc.valor)}</span> : null}
                  {detalhes.length ? <span className="block text-xs text-slate-500">{detalhes.join(" · ")}</span> : null}
                  {!doc ? <span className="text-slate-500">Não enviado</span> : null}
                  {doc && !doc.valor && doc.tem_arquivo ? <span className="text-slate-500">Arquivo enviado</span> : null}
                  {doc ? <span className="block text-xs text-slate-500">{doc.origem === "tce" ? "Do TCE" : "Do sistema antigo"} · atualizado em {dateBr(doc.atualizado_em)}</span> : null}
                </span>
                {doc?.tem_arquivo ? (
                  <a className="text-sm font-semibold text-cyan-700 hover:underline" href={`/api/v1/candidatos/${idCandidato}/documentos/${doc.id}/arquivo`} target="_blank" rel="noreferrer">
                    Abrir arquivo
                  </a>
                ) : <span className="text-xs text-slate-400">Sem arquivo</span>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
