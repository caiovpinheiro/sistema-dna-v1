import { Card } from "@/components/ui";
import { dateBr } from "@/lib/format";

export type Experiencia = { cargo: string | null; empresa: string | null; atribuicoes: string | null };
export type Curriculo = {
  objetivo: string | null; ultimo_cargo: string | null; ano_escolar: string | null; terminoestudo: string | null; origem: string | null; escolaridade: string | null;
  instituicao: { razao_social: string | null; nome_fantasia: string | null; parece: string | null; conveniada: string | null } | null;
  experiencias: Experiencia[]; conhecimentos: { descricao: string | null; nivel: string | null }[]; disc: string | null; entrevistas: number;
  vagas: { id_vaga: string; cargo: string | null; empresa: string | null }[];
};
export type AtendimentoCandidato = {
  captado_por?: string;
  resumo_cv?: string;
  resumo_entrevista?: string;
  teste_comportamental?: string;
  info_conducao?: string;
  descricao_vaga?: string;
  escolaridade?: string;
  idade?: string;
  tipo_de_vaga?: string;
};
/** Ficha do candidato devolvida pela API (a mesma em /candidatos/:id e dentro de /processos/:id). */
export type FichaCandidatoDados = {
  id_candidato: string; nome: string; cpf: string; email: string; celular: string | null; telefonefixo: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null;
  cidade: string | null; estado: string | null; curso: string | null; nome_escola: string | null; periodo: string | null;
  ctps: string | null; datanascimento: string | null; ultimaalteracao: string | null; curriculo: Curriculo;
  vinculo?: "dna" | "empresa"; empresa_nome?: string | null;
  atendimento?: AtendimentoCandidato | null;
};

/**
 * As seções do candidato que aparecem igual na página do candidato e na do processo.
 * O que é de uma vaga (resumo da entrevista, condução, dados da vaga) fica só no processo.
 */
export function FichaCandidato({ data }: { data: FichaCandidatoDados }) {
  const cv = data.curriculo;
  const atendimento = data.atendimento ?? {};
  const escola = cv.instituicao?.nome_fantasia || cv.instituicao?.razao_social || data.nome_escola;
  const temDadosAtendimento = atendimento.escolaridade || atendimento.idade || atendimento.tipo_de_vaga;
  return (
    <>
      {atendimento.resumo_cv ? <Card><h2 className="mb-2 font-bold">Currículo do atendimento</h2><p className="whitespace-pre-wrap text-sm text-slate-600">{atendimento.resumo_cv}</p></Card> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Objetivo</p><p className="font-semibold">{cv.objetivo || "Não informado"}</p></Card>
        <Card><p className="text-xs text-slate-500">Último cargo</p><p className="font-semibold">{cv.ultimo_cargo || "Sem experiência"}</p></Card>
        <Card><p className="text-xs text-slate-500">Entrevistas</p><p className="font-semibold">{cv.entrevistas ? `${cv.entrevistas} encaminhamento(s)` : "Ainda não foi encaminhado para entrevista"}</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 font-bold">Perfil comportamental</h2>
          {atendimento.teste_comportamental ? <p className="whitespace-pre-wrap text-sm text-slate-600">{atendimento.teste_comportamental}</p> : null}
          {cv.disc ? <p className="mt-2 text-sm text-slate-600">DISC: {cv.disc}</p> : null}
          {!atendimento.teste_comportamental && !cv.disc ? <p className="text-sm text-slate-600">Não analisado. O teste comportamental ainda não foi feito.</p> : null}
        </Card>
        <Card><h2 className="mb-2 font-bold">Conhecimentos técnicos</h2>{cv.conhecimentos.length ? cv.conhecimentos.map((item) => <p key={`${item.descricao}-${item.nivel}`} className="text-sm">{item.descricao}{item.nivel ? ` · nível ${item.nivel}` : ""}</p>) : <p className="text-sm text-slate-500">O candidato não informou conhecimentos extracurriculares.</p>}</Card>
        <Card>
          <h2 className="mb-2 font-bold">Formação acadêmica</h2>
          <p className="text-sm">Modalidade: {cv.escolaridade || data.curso || "Não informada"}</p>
          <p className="text-sm">Escola: {escola || "Não informada"}</p>
          <p className="text-sm">Turno: {data.periodo || "Não informado"}</p>
          <p className="text-sm">Ano escolar: {cv.ano_escolar || "Não informado"}</p>
          <p className="text-sm">Término: {dateBr(cv.terminoestudo)}</p>
          <p className="text-sm">Conveniada: {cv.instituicao?.conveniada === "1" ? "Sim" : "Não"}</p>
          <p className="text-sm">Experiência da instituição: {cv.instituicao?.parece || "Não informada"}</p>
        </Card>
      </div>
      {temDadosAtendimento ? (
        <Card>
          <h2 className="mb-2 font-bold">Dados do atendimento</h2>
          <div className="grid gap-1 text-sm text-slate-600">
            {atendimento.escolaridade ? <p>Escolaridade: {atendimento.escolaridade}</p> : null}
            {atendimento.idade ? <p>Idade: {atendimento.idade}</p> : null}
            {atendimento.tipo_de_vaga ? <p>Tipo de vaga: {atendimento.tipo_de_vaga}</p> : null}
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="mb-3 font-bold">Experiência profissional</h2>
        {cv.experiencias.length ? cv.experiencias.map((item) => (
          <p key={`${item.cargo}-${item.empresa}`} className="text-sm"><strong>{item.cargo || "Cargo não informado"}</strong>{item.empresa ? ` na ${item.empresa}` : ""}{item.atribuicoes ? ` — ${item.atribuicoes}` : ""}</p>
        )) : <p className="text-sm text-slate-500">O candidato não informou experiência profissional.</p>}
      </Card>
    </>
  );
}
