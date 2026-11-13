import type { ReactNode } from "react";
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
      <dl className="grid gap-3 sm:grid-cols-3">
        <Destaque rotulo="Objetivo">{cv.objetivo || "Não informado"}</Destaque>
        <Destaque rotulo="Último cargo">{cv.ultimo_cargo || "Sem experiência"}</Destaque>
        <Destaque rotulo="Entrevistas">{cv.entrevistas ? `${cv.entrevistas} ${cv.entrevistas === 1 ? "encaminhamento" : "encaminhamentos"}` : "Ainda não foi encaminhado"}</Destaque>
      </dl>
      {atendimento.resumo_cv ? (
        <Card className="grid gap-2">
          <Titulo>Currículo do atendimento</Titulo>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{atendimento.resumo_cv}</p>
        </Card>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <Card className="grid gap-3">
          <Titulo>Formação acadêmica</Titulo>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Par rotulo="Modalidade" largo>{cv.escolaridade || data.curso || "Não informada"}</Par>
            <Par rotulo="Escola" largo>{escola || "Não informada"}</Par>
            <Par rotulo="Turno">{data.periodo || "Não informado"}</Par>
            <Par rotulo="Ano escolar">{cv.ano_escolar || "Não informado"}</Par>
            <Par rotulo="Término">{dateBr(cv.terminoestudo)}</Par>
            <Par rotulo="Conveniada">{cv.instituicao?.conveniada === "1" ? "Sim" : "Não"}</Par>
            <Par rotulo="Experiência da instituição" largo>{cv.instituicao?.parece || "Não informada"}</Par>
          </dl>
        </Card>
        <Card className="grid gap-2">
          <Titulo>Perfil comportamental</Titulo>
          {atendimento.teste_comportamental ? <p className="whitespace-pre-wrap text-sm text-slate-700">{atendimento.teste_comportamental}</p> : null}
          {cv.disc ? <p className="text-sm text-slate-700"><span className="text-xs text-slate-500">DISC</span> <span className="font-semibold">{cv.disc}</span></p> : null}
          {!atendimento.teste_comportamental && !cv.disc ? <p className="text-sm text-slate-500">Não analisado. O teste comportamental ainda não foi feito.</p> : null}
        </Card>
        <Card className="grid gap-2">
          <Titulo>Conhecimentos técnicos</Titulo>
          {cv.conhecimentos.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {cv.conhecimentos.map((item) => (
                <li key={`${item.descricao}-${item.nivel}`} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {item.descricao}{item.nivel ? <span className="font-normal text-slate-500"> · {item.nivel}</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">O candidato não informou conhecimentos extracurriculares.</p>}
        </Card>
      </div>
      {temDadosAtendimento ? (
        <Card className="grid gap-3">
          <Titulo>Dados do atendimento</Titulo>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {atendimento.escolaridade ? <Par rotulo="Escolaridade">{atendimento.escolaridade}</Par> : null}
            {atendimento.idade ? <Par rotulo="Idade">{atendimento.idade}</Par> : null}
            {atendimento.tipo_de_vaga ? <Par rotulo="Tipo de vaga">{atendimento.tipo_de_vaga}</Par> : null}
          </dl>
        </Card>
      ) : null}
      <Card className="grid gap-3">
        <Titulo>Experiência profissional</Titulo>
        {cv.experiencias.length ? (
          <ul className="grid">
            {cv.experiencias.map((item) => (
              <li key={`${item.cargo}-${item.empresa}`} className="border-t border-slate-100 py-2.5 first:border-0 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold text-slate-700">{item.cargo || "Cargo não informado"}{item.empresa ? <span className="font-normal text-slate-500"> na {item.empresa}</span> : null}</p>
                {item.atribuicoes ? <p className="text-sm text-slate-600">{item.atribuicoes}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">O candidato não informou experiência profissional.</p>}
      </Card>
    </>
  );
}

function Titulo({ children }: { children: ReactNode }) {
  return <h2 className="text-[15px] font-bold text-navy-900">{children}</h2>;
}

/** Número/frase em destaque no topo da ficha. */
function Destaque({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 font-semibold text-navy-900">{children}</dd>
    </div>
  );
}

function Par({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words text-sm text-slate-700">{children}</dd>
    </div>
  );
}
