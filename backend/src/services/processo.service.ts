import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AppError } from "../lib/errors.js";
import { cepCadastro, escolaridadeCadastro, sexoCadastro } from "../lib/atendimento.js";
import { etapaInicial, podeMover } from "../lib/processo.js";
import { isValidCpf, onlyDigits } from "../lib/normalize.js";
import { CandidatoRepository } from "../repositories/candidato.repository.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import { ProcessoRepository } from "../repositories/processo.repository.js";
import { one, type Db } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { Atendimento, ProcessoCreate, ProcessoListQuery, ProcessoMover } from "../schemas/processo.js";

function telefones(valor: string) {
  let digitos = onlyDigits(valor);
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length < 10 || digitos.length > 11) throw new AppError(422, "TELEFONE_INVALIDO", "Informe o celular com DDD.");
  return [digitos, `55${digitos}`];
}

function dadosAtendimento(input: Atendimento): Record<string, string> {
  const dados: Record<string, string> = { captado_por: "dnawork" };
  const add = (chave: string, valor: string | null | undefined) => {
    const texto = valor?.trim();
    if (texto) dados[chave] = texto.replaceAll("\\n", "\n");
  };
  add("resumo_cv", input.resumo_cv);
  add("resumo_entrevista", input.resumo_entrevista);
  add("descricao_vaga", input.descricao_vaga);
  add("teste_comportamental", input.teste_comportamental);
  add("info_conducao", input.info_conducao);
  add("escolaridade", escolaridadeCadastro(input.escolaridade) ?? undefined);
  add("idade", input.idade);
  add("tipo_de_vaga", input.tipo_de_vaga);
  add("deal_id", input.deal_id);
  return dados;
}

function hojeSp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export class ProcessoService {
  constructor(
    private readonly db: Pool,
    private readonly repo: ProcessoRepository,
    private readonly vagas: VagaRepository,
    private readonly candidatos: CandidatoRepository,
    private readonly empresas: EmpresaRepository,
  ) {}

  async list(query: ProcessoListQuery) {
    const result = await this.repo.list(this.db, query);
    return { data: result.rows, meta: { page: query.page, pageSize: query.pageSize, total: result.total } };
  }

  async get(id: string) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
    const historico = await this.repo.historico(this.db, id);
    return { ...row, historico };
  }

  async create(input: ProcessoCreate) {
    const vaga = await this.vagas.findById(this.db, input.id_vaga);
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    if (vaga.id_empresa !== input.id_empresa) {
      throw new AppError(409, "EMPRESA_DIVERGENTE", "A vaga não pertence à empresa informada.");
    }
    const empresa = await this.empresas.findById(this.db, input.id_empresa);
    if (!empresa) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const candidato = await this.candidatos.findById(this.db, input.id_candidato);
    if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    const etapa = etapaInicial(input.origem, input.data_encaminhamento ?? null);
    try {
      const id = await this.repo.insert(this.db, {
        idCandidato: input.id_candidato,
        idEmpresa: input.id_empresa,
        idVaga: input.id_vaga,
        origem: input.origem,
        dataRecebimento: input.data_recebimento,
        dataEncaminhamento: input.data_encaminhamento ?? null,
        etapa,
        observacao: input.observacao ?? null,
      });
      return this.get(id);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(409, "PROCESSO_ABERTO", "Este candidato já tem um processo em andamento nesta vaga.");
      }
      throw error;
    }
  }

  async criarCandidato(input: Atendimento) {
    const fones = telefones(input.celular);
    const cpf = input.cpf ? onlyDigits(input.cpf) : "";
    if (cpf && !isValidCpf(cpf)) throw new AppError(422, "CPF_INVALIDO", "CPF inválido.");
    const data = input.data_recebimento || hojeSp();
    const observacao = "Captado pela DNAWORK no atendimento.";
    const cep = cepCadastro(input.cep);
    const sexo = sexoCadastro(input.sexo);
    const escola = escolaridadeCadastro(input.escolaridade);
    let idCandidato = await this.candidatoDoAtendimento(cpf, fones);
    let criado = false;
    if (!idCandidato) {
      idCandidato = randomUUID();
      criado = true;
      await this.db.query(`
        INSERT INTO dna_work.candidato (id_candidato, nome, cpf, celular, email, cep, sexo, escola, datacadastro, colaborador, obs, atendimento)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11::jsonb)
      `, [idCandidato, input.nome.trim(), cpf || null, fones[0], input.email?.trim().toLowerCase() || null, cep, sexo, escola, data.replaceAll("-", "/"), observacao, JSON.stringify(dadosAtendimento(input))]);
    } else {
      await this.db.query(`
        UPDATE dna_work.candidato SET
          cep = CASE WHEN cep IS NULL OR btrim(cep) = '' THEN $2 ELSE cep END,
          sexo = CASE WHEN sexo IS NULL OR btrim(sexo) = '' THEN $3 ELSE sexo END,
          escola = CASE WHEN escola IS NULL OR btrim(escola) = '' THEN $4 ELSE escola END,
          email = CASE WHEN email IS NULL OR btrim(email) = '' THEN $5 ELSE email END,
          celular = CASE WHEN celular IS NULL OR btrim(celular) = '' THEN $6 ELSE celular END,
          atendimento = coalesce(atendimento, '{}'::jsonb) || $7::jsonb
        WHERE id_candidato = $1
      `, [idCandidato, cep, sexo, escola, input.email?.trim().toLowerCase() || null, fones[0], JSON.stringify(dadosAtendimento(input))]);
    }
    return { id_candidato: idCandidato, nome: input.nome.trim(), celular: fones[0], criado, captado_por: "dnawork" as const };
  }

  async receberAtendimento(input: Atendimento) {
    const vaga = await this.vagaDoAtendimento(input);
    const candidato = await this.criarCandidato(input);
    const idCandidato = candidato.id_candidato;
    const data = input.data_recebimento || hojeSp();
    const observacao = "Captado pela DNAWORK no atendimento.";
    const dados = dadosAtendimento(input);
    const aberto = await this.repo.aberto(this.db, idCandidato, vaga.id_vaga);
    if (aberto) {
      await this.repo.gravarAtendimento(this.db, aberto.id, dados);
      return { id: aberto.id, id_candidato: idCandidato, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, origem: "dnawork", etapa: aberto.etapa, criado: false, candidato_novo: candidato.criado };
    }
    try {
      const id = await this.repo.insert(this.db, {
        idCandidato,
        idEmpresa: vaga.id_empresa,
        idVaga: vaga.id_vaga,
        origem: "dnawork",
        dataRecebimento: data,
        dataEncaminhamento: null,
        etapa: "recebido",
        observacao,
      });
      await this.repo.gravarAtendimento(this.db, id, dados);
      return { id, id_candidato: idCandidato, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, origem: "dnawork" as const, etapa: "recebido" as const, criado: true, candidato_novo: candidato.criado };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const existente = await this.repo.aberto(this.db, idCandidato, vaga.id_vaga);
        if (existente) {
          await this.repo.gravarAtendimento(this.db, existente.id, dados);
          return { id: existente.id, id_candidato: idCandidato, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, origem: "dnawork", etapa: existente.etapa, criado: false, candidato_novo: candidato.criado };
        }
      }
      throw error;
    }
  }

  private async vagaDoAtendimento(input: Atendimento) {
    if (input.id_vaga) {
      const vaga = await one<{ id_vaga: string; id_empresa: string }>(this.db, `
        SELECT id_vaga, id_empresa FROM dna_work.vaga WHERE id_vaga = $1
      `, [input.id_vaga]);
      if (!vaga?.id_empresa) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
      return vaga;
    }
    let empresaId = input.id_empresa ?? "";
    if (!empresaId && input.empresa) {
      const empresa = await this.empresaPorNome(input.empresa);
      if (!empresa) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
      empresaId = empresa.id_empresa;
    }
    if (!empresaId || !input.cargo?.trim()) {
      throw new AppError(422, "VAGA_OBRIGATORIA", "Informe id_vaga ou a empresa junto com o cargo.");
    }
    const vaga = await one<{ id_vaga: string; id_empresa: string }>(this.db, `
      SELECT id_vaga, id_empresa FROM dna_work.vaga
      WHERE id_empresa = $1 AND (cargo ILIKE $2 OR cargo ILIKE $3)
      ORDER BY CASE WHEN cargo ILIKE $2 THEN 0 ELSE 1 END, CASE WHEN status = 0 THEN 0 ELSE 1 END, data_adicao DESC NULLS LAST
      LIMIT 1
    `, [empresaId, input.cargo.trim(), `%${input.cargo.trim()}%`]);
    if (!vaga?.id_empresa) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Não há vaga com esse cargo nesta empresa.");
    return vaga;
  }

  private async empresaPorNome(nome: string) {
    const bruto = nome.trim();
    const partes = bruto.split(/\s+-\s+/).map((parte) => parte.trim()).filter((parte) => parte.length >= 3);
    const principal = partes[0] ?? bruto;
    const complemento = partes[1] ?? "";
    return one<{ id_empresa: string }>(this.db, `
      SELECT id_empresa FROM dna_work.empresa
      WHERE nome_fantasia ILIKE $1 OR razao_social ILIKE $1
         OR nome_fantasia ILIKE $2 OR razao_social ILIKE $2
         OR ($4 <> '' AND (
              (nome_fantasia ILIKE $3 AND nome_fantasia ILIKE $4)
           OR (razao_social ILIKE $3 AND razao_social ILIKE $4)
           OR ((coalesce(nome_fantasia, '') || ' ' || coalesce(razao_social, '')) ILIKE $3
               AND (coalesce(nome_fantasia, '') || ' ' || coalesce(razao_social, '')) ILIKE $4)
         ))
      ORDER BY
        CASE WHEN nome_fantasia ILIKE $1 OR razao_social ILIKE $1 THEN 0
             WHEN nome_fantasia ILIKE $2 OR razao_social ILIKE $2 THEN 1
             ELSE 2 END,
        CASE WHEN status = 1 THEN 0 ELSE 1 END
      LIMIT 1
    `, [bruto, `%${bruto}%`, `%${principal}%`, complemento ? `%${complemento}%` : ""]);
  }

  private async candidatoDoAtendimento(cpf: string, fones: string[]) {
    if (cpf) {
      const porCpf = await this.candidatos.findByCpf(this.db, cpf);
      if (porCpf) return porCpf.id_candidato;
    }
    const porFone = await one<{ id_candidato: string }>(this.db, `
      SELECT id_candidato FROM dna_work.candidato
      WHERE regexp_replace(coalesce(celular, ''), '\\D', '', 'g') = ANY($1::text[])
         OR regexp_replace(coalesce(telefonefixo, ''), '\\D', '', 'g') = ANY($1::text[])
      LIMIT 1
    `, [fones]);
    return porFone?.id_candidato ?? null;
  }

  async mover(id: string, input: ProcessoMover) {
    const atual = await this.repo.findById(this.db, id);
    if (!atual) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
    if (input.etapa === "contratado") {
      throw new AppError(409, "ETAPA_PELA_CONTRATACAO", "A etapa contratado é registrada pela contratação do candidato.");
    }
    if (!podeMover(atual.etapa, input.etapa)) {
      throw new AppError(409, "ETAPA_INVALIDA", "Esta etapa não pode ser aplicada ao processo atual.");
    }
    const encaminhamento = input.etapa === "encaminhado" && !atual.data_encaminhamento ? hojeSp() : null;
    await this.repo.mover(this.db, id, input.etapa, encaminhamento);
    await this.repo.movimento(this.db, id, input.etapa, input.observacao ?? null);
    return this.get(id);
  }

  async vincularContratacao(db: Db, input: { idProcesso?: string; idCandidato: string; idVaga: string; idContratacao: number }) {
    if (input.idProcesso) {
      const processo = await this.repo.findById(db, input.idProcesso);
      if (!processo) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
      if (processo.id_candidato !== input.idCandidato || processo.id_vaga !== input.idVaga) {
        throw new AppError(409, "PROCESSO_DIVERGENTE", "O processo não é deste candidato nesta vaga.");
      }
      if (processo.etapa === "contratado" && processo.id_contratacao === input.idContratacao) return;
      if (processo.etapa === "contratado" || processo.etapa === "reprovado" || processo.etapa === "desistente") {
        throw new AppError(409, "PROCESSO_ENCERRADO", "O processo selecionado já foi encerrado.");
      }
      await this.repo.vincular(db, processo.id, input.idContratacao);
      return;
    }
    const aberto = await this.repo.aberto(db, input.idCandidato, input.idVaga);
    if (aberto) await this.repo.vincular(db, aberto.id, input.idContratacao);
  }
}
