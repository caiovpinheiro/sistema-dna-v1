import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { Alerta } from "@/components/pagina";
import { Badge, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
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

const ORIGEM: Record<string, string> = { tce: "Do TCE", ficha: "Enviado na ficha" };

/** Aceitos no envio; o servidor confere o tipo real pelo conteúdo. */
const ACEITOS = "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp";
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

/** Arquivo em base64 (sem o prefixo "data:…;base64,"). */
function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

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
    <Card className="grid gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-navy-900">Documentos do candidato</h2>
        <p className="text-sm text-slate-500">Gravados quando o TCE é gerado ou editado, os arquivos que o sistema antigo já tinha e os enviados aqui (PDF, PNG, JPG ou WEBP até 5 MB).</p>
      </div>
      {docs.isLoading ? <Skeleton className="h-24" /> : docs.isError ? <Alerta>Não foi possível carregar os documentos. Atualize a página para tentar de novo.</Alerta> : (
        <ul className="grid">
          {TIPOS.map(({ tipo, nome }) => {
            const doc = porTipo.get(tipo);
            const detalhes = doc?.dados && tipo === "responsavel"
              ? ORDEM_RESPONSAVEL.filter((chave) => doc.dados?.[chave]).map((chave) => `${ROTULO_RESPONSAVEL[chave] ?? chave}: ${legivel(chave, doc.dados![chave])}`)
              : [];
            return (
              <li key={tipo} className="grid gap-1 border-t border-slate-100 py-3 first:border-0 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-sm font-semibold text-slate-700">{nome}</span>
                <span className="min-w-0 text-sm text-slate-700">
                  {doc?.valor ? <span className="block break-words">{valorDoDocumento(tipo, doc.valor)}</span> : null}
                  {detalhes.length ? <span className="block text-xs text-slate-500">{detalhes.join(" · ")}</span> : null}
                  {!doc ? <Badge value="encerrada">Não enviado</Badge> : null}
                  {doc && !doc.valor && doc.tem_arquivo ? <span className="text-slate-500">Arquivo enviado</span> : null}
                  {doc ? <span className="block text-xs text-slate-500">{ORIGEM[doc.origem] ?? "Do sistema antigo"} · atualizado em {dateBr(doc.atualizado_em)}</span> : null}
                </span>
                <AcoesArquivo idCandidato={idCandidato} tipo={tipo} nome={nome} doc={doc} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Abrir o arquivo guardado e anexar (ou trocar) o arquivo deste tipo de documento. */
function AcoesArquivo({ idCandidato, tipo, nome, doc }: { idCandidato: string; tipo: string; nome: string; doc: Documento | undefined }) {
  const client = useQueryClient();
  const campo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState("");
  const enviar = useMutation({
    mutationFn: async (arquivo: File) => api<Documento>(`/api/v1/candidatos/${idCandidato}/documentos/${tipo}/arquivo`, {
      method: "PUT",
      body: JSON.stringify({ nome: arquivo.name, base64: await lerBase64(arquivo) }),
    }),
    onSuccess: async () => {
      setErro("");
      await client.invalidateQueries({ queryKey: ["candidato-documentos", idCandidato] });
    },
    onError: (error) => setErro(error instanceof ApiError || error instanceof Error ? error.message : "Não foi possível enviar o arquivo."),
  });

  function escolher(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    if (arquivo.size > TAMANHO_MAXIMO) return setErro("O arquivo passa de 5 MB.");
    if (doc?.tem_arquivo && !window.confirm(`Trocar o arquivo de ${nome}? O arquivo atual será substituído por "${arquivo.name}".`)) return;
    setErro("");
    enviar.mutate(arquivo);
  }

  return (
    <span className="grid justify-items-start gap-1 sm:justify-items-end">
      <span className="flex flex-wrap items-center gap-2">
        {doc?.tem_arquivo ? (
          <a className="acao acao-cyan inline-flex w-fit items-center gap-1" href={`/api/v1/candidatos/${idCandidato}/documentos/${doc.id}/arquivo`} target="_blank" rel="noreferrer">
            <FileText size={13} /> Abrir arquivo
          </a>
        ) : <span className="text-xs text-slate-400">Sem arquivo</span>}
        <button
          type="button"
          className="acao inline-flex w-fit items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-100"
          disabled={enviar.isPending}
          onClick={() => campo.current?.click()}
        >
          <Upload size={13} /> {enviar.isPending ? "Enviando…" : doc?.tem_arquivo ? "Trocar arquivo" : "Anexar arquivo"}
        </button>
        <input ref={campo} type="file" accept={ACEITOS} className="hidden" aria-label={`Arquivo de ${nome}`} onChange={escolher} />
      </span>
      {erro ? <span role="alert" className="text-xs text-rose-600">{erro}</span> : null}
    </span>
  );
}
