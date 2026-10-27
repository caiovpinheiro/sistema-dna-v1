import type { Db } from "../repositories/sql.js";
import { many, one } from "../repositories/sql.js";

type Pagina = { page: number; pageSize: number };

function corte(page: number, pageSize: number) {
  const pagina = Number.isFinite(page) && page > 0 ? page : 1;
  const tamanho = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 50;
  return { pagina, tamanho, offset: (pagina - 1) * tamanho };
}

function texto(value: string | undefined) {
  return value?.trim() ?? "";
}

function statusFatura(status: number | null) {
  if (status === 1) return "Faturado";
  if (status === 2) return "Parcial";
  return "Aberta";
}

function aceitaStatus(filtro: string, status: number | null) {
  if (!filtro) return true;
  if (filtro === "3") return status !== 1;
  if (filtro === "0") return status == null || status === 0;
  if (filtro === "1") return status === 1;
  if (filtro === "2") return status === 2;
  return true;
}

function periodo(mes: string, ano: string) {
  const mesNum = Number(mes);
  const anoNum = Number(ano);
  const anterior = mesNum === 1 ? { mes: 12, ano: anoNum - 1 } : { mes: mesNum - 1, ano: anoNum };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    data10e20: `${ano}/${pad(mesNum)}/`,
    data30: `${ano}/${pad(mesNum)}/30`,
    dataInicio10e20: `${anterior.ano}/${pad(anterior.mes)}/`,
    dataInicio30: `${anterior.ano}/${pad(anterior.mes)}/30`,
  };
}

export class LegadoService {
  constructor(private readonly db: Db) {}

  async faturamento(query: { empresa?: string; fechamento?: string; mes?: string; ano?: string; status?: string; page?: number; pageSize?: number }) {
    const mes = texto(query.mes) || String(new Date().getMonth() + 1).padStart(2, "0");
    const ano = texto(query.ano) || String(new Date().getFullYear());
    const datas = periodo(mes, ano);
    const empresa = texto(query.empresa);
    const fechamento = texto(query.fechamento);
    const empresas = await many<{
      id_empresa: string;
      razao_social: string | null;
      nome_fantasia: string | null;
      cnpj: string | null;
      datafechamento: string | null;
      tipo: string;
      matriz: string | null;
      usa_asaas: string | null;
      itens: number;
    }>(this.db, `
      SELECT e.id_empresa::text AS id_empresa,
             e.razao_social, e.nome_fantasia, e.cnpj,
             e.datafechamento::text AS datafechamento,
             CASE WHEN e.tipo_empresa::text = '1' THEN 'Matriz' ELSE 'Filial' END AS tipo,
             e.matriz::text AS matriz,
             e.usa_asaas::text AS usa_asaas,
             count(DISTINCT cv.id_vaga)::int AS itens
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      JOIN dna_work.empresa e ON v.id_empresa = e.id_empresa
      JOIN dna_work.faturamento_empresa fe ON fe.id_empresa = e.id_empresa AND fe.modalidade_vaga::text = v.tipo_vaga::text
      JOIN dna_work.vaga_valores vv ON vv.comparador::text = v.comparador::text
      WHERE (
        cv.data_demicao IS NULL OR cv.data_demicao = ''
        OR (
          CASE WHEN e.datafechamento::text LIKE '30' THEN cv.data_demicao >= $1
               ELSE cv.data_demicao >= ($2 || e.datafechamento::text) END
          AND cv.data_demicao <> cv.data_contratacao
        )
      )
      AND (
        CASE WHEN e.datafechamento::text LIKE '30' THEN cv.data_contratacao <= $3
             ELSE cv.data_contratacao <= ($4 || e.datafechamento::text) END
        OR CASE WHEN e.datafechamento::text LIKE '30' THEN cv.datainicio <= $3
                ELSE cv.datainicio <= ($4 || e.datafechamento::text) END
      )
      AND v.status::text NOT IN ('5', '4', '3')
      AND ($5 = '' OR trim(e.datafechamento::text) = $5 OR ltrim(trim(e.datafechamento::text), '0') = ltrim($5, '0'))
      AND ($6 = '' OR e.razao_social ILIKE $6 OR e.nome_fantasia ILIKE $6 OR e.razao_sem_acento ILIKE $6 OR e.fantasia_sem_acento ILIKE $6 OR e.cnpj ILIKE $6)
      GROUP BY e.id_empresa, e.razao_social, e.nome_fantasia, e.cnpj, e.datafechamento, e.tipo_empresa, e.matriz, e.usa_asaas
      ORDER BY e.razao_social
    `, [datas.dataInicio30, datas.dataInicio10e20, datas.data30, datas.data10e20, fechamento, empresa ? `%${empresa}%` : ""]);

    const ids = empresas.map((item) => item.id_empresa);
    const matrizesFora = [...new Set(empresas.filter((item) => item.usa_asaas === "2" && item.matriz && !ids.includes(item.matriz)).map((item) => item.matriz as string))];
    const todosIds = [...ids, ...matrizesFora];
    const faturas = todosIds.length ? await many<{ id_empresa: string; status_fatura: number | null; valor: string | null }>(this.db, `
      SELECT id_empresa::text AS id_empresa,
             max(status_fatura) AS status_fatura,
             sum(CASE WHEN replace(coalesce(valor_final, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
                      THEN replace(valor_final, ',', '.')::numeric ELSE 0 END)::text AS valor
      FROM dna_work.fatura
      WHERE ltrim(mes::text, '0') = ltrim($1, '0') AND ano::text = $2 AND id_empresa::text = ANY($3::text[])
      GROUP BY id_empresa
    `, [mes, ano, todosIds]) : [];
    const envios = ids.length ? await many<{ id_empresa: string; data: string | null }>(this.db, `
      SELECT DISTINCT ON (id_empresa) id_empresa::text AS id_empresa, data::text AS data
      FROM dna_work.cobranca_email
      WHERE ano::text = $1 AND ltrim(mes::text, '0') = ltrim($2, '0') AND id_empresa::text = ANY($3::text[])
      ORDER BY id_empresa, id DESC
    `, [ano, mes, ids]) : [];
    const faturaPorEmpresa = new Map(faturas.map((item) => [item.id_empresa, item]));
    const envioPorEmpresa = new Map(envios.map((item) => [item.id_empresa, item.data]));
    const filtro = texto(query.status);
    const itens = empresas.filter((item) => aceitaStatus(filtro, faturaPorEmpresa.get(item.id_empresa)?.status_fatura ?? null)).map((item) => {
      const fatura = faturaPorEmpresa.get(item.id_empresa);
      const valor = fatura?.valor != null ? Number(fatura.valor) : null;
      return {
        razao_social: item.razao_social,
        nome_fantasia: item.nome_fantasia,
        cnpj: item.cnpj,
        tipo: item.tipo,
        datafechamento: item.datafechamento,
        itens: item.itens,
        valor,
        status: statusFatura(fatura?.status_fatura ?? null),
        envio: envioPorEmpresa.get(item.id_empresa) ?? null,
      };
    });
    const matrizBase = matrizesFora.length ? await many<{ id_empresa: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; datafechamento: string | null }>(this.db, `
      SELECT id_empresa::text AS id_empresa, razao_social, nome_fantasia, cnpj, datafechamento::text AS datafechamento
      FROM dna_work.empresa WHERE id_empresa::text = ANY($1::text[])
      ORDER BY razao_social
    `, [matrizesFora]) : [];
    const matriz = matrizBase.filter((item) => aceitaStatus(filtro, faturaPorEmpresa.get(item.id_empresa)?.status_fatura ?? null)).map((item) => ({
      razao_social: item.razao_social,
      nome_fantasia: item.nome_fantasia,
      cnpj: item.cnpj,
      datafechamento: item.datafechamento,
      status: statusFatura(faturaPorEmpresa.get(item.id_empresa)?.status_fatura ?? null),
    }));
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const totalReceber = itens.reduce((soma, item) => soma + (item.valor ?? 0), 0);
    return {
      data: { matriz, itens: itens.slice(offset, offset + tamanho) },
      meta: { total: itens.length, page: pagina, pageSize: tamanho, totalReceber },
    };
  }

  async procfy(query: { de?: string; ate?: string; status?: string; tipoData?: string; sistema?: string; page?: number; pageSize?: number }) {
    const tipo = ["vencimento_fatura", "data_pg", "data_cadastro"].includes(texto(query.tipoData)) ? texto(query.tipoData) : "vencimento_fatura";
    const sistema = texto(query.sistema) || "ambos";
    if (sistema === "disc") {
      return { data: [], meta: { total: 0, page: 1, pageSize: query.pageSize ?? 50, totalReceber: 0 } };
    }
    const de = texto(query.de).replaceAll("-", "/");
    const ate = texto(query.ate).replaceAll("-", "/");
    const status = texto(query.status);
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const where = `
      WHERE ($1 = '' OR f.${tipo}::text >= $1)
        AND ($2 = '' OR f.${tipo}::text <= $2 || '/31')
        AND ($3 = '' OR f.status_fatura::text = $3)
        AND coalesce(f.tipo_fatura, '') <> 'Subfatura'
    `;
    const params = [de ? `${de}/01` : "", ate, status];
    const total = await one<{ total: number; valor: string }>(this.db, `
      SELECT count(*)::int AS total,
             coalesce(sum(CASE WHEN replace(coalesce(f.valor_final, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
                               THEN replace(f.valor_final, ',', '.')::numeric ELSE 0 END), 0)::text AS valor
      FROM dna_work.fatura f
      JOIN dna_work.empresa e ON e.id_empresa = f.id_empresa
      ${where}
    `, params);
    const rows = await many<{
      razao_social: string | null; nome_fantasia: string | null; tipo: string | null;
      vencimento: string | null; valor: string | null; forma_pg: string | null; data_pg: string | null; status_fatura: number | null;
    }>(this.db, `
      SELECT e.razao_social, e.nome_fantasia, f.tipo_fatura AS tipo, f.vencimento_fatura AS vencimento,
             f.valor_final AS valor, f.forma_pg, f.data_pg, f.status_fatura
      FROM dna_work.fatura f
      JOIN dna_work.empresa e ON e.id_empresa = f.id_empresa
      ${where}
      ORDER BY f.vencimento_fatura DESC NULLS LAST, e.razao_social
      LIMIT $4 OFFSET $5
    `, [...params, tamanho, offset]);
    return {
      data: rows.map((item) => ({
        razao_social: item.razao_social,
        nome_fantasia: item.nome_fantasia,
        tipo: item.tipo,
        vencimento: item.vencimento,
        valor: item.valor != null && item.valor !== "" ? Number(String(item.valor).replace(",", ".")) : null,
        forma_pg: item.forma_pg,
        data_pg: item.data_pg,
        status: item.status_fatura === 1 ? "Paga" : item.status_fatura === 2 ? "Cancelada" : "Aberta",
      })),
      meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho, totalReceber: Number(total?.valor ?? 0) },
    };
  }

  async comissao(query: { empresa?: string; consultor?: string; mes?: string; ano?: string; status?: string; page?: number; pageSize?: number }) {
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const empresa = texto(query.empresa);
    const consultor = texto(query.consultor);
    const mes = texto(query.mes);
    const ano = texto(query.ano);
    const status = texto(query.status);
    const where = `
      WHERE ($1 = '' OR p.nome_fantasia ILIKE $1 OR p.razao_social ILIKE $1 OR p.cnpj ILIKE $1)
        AND ($2 = '' OR p.usuario::text ILIKE $2 OR p."VendedorBase"::text ILIKE $2 OR p.treinamento::text ILIKE $2)
        AND ($3 = '' OR ltrim(p.mes::text, '0') = ltrim($3, '0'))
        AND ($4 = '' OR p.ano::text = $4)
        AND ($5 = '' OR ($5 = '1' AND coalesce(p.data_pg_comissao, '') <> '') OR ($5 = '0' AND coalesce(p.data_pg_comissao, '') = ''))
    `;
    const params = [empresa ? `%${empresa}%` : "", consultor && consultor !== "todos" ? `%${consultor}%` : "", mes, ano, status];
    const total = await one<{ total: number; valor: string }>(this.db, `
      SELECT count(*)::int AS total,
             coalesce(sum(CASE WHEN replace(p."ValorFinalComissao"::text, ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
                               THEN replace(p."ValorFinalComissao"::text, ',', '.')::numeric ELSE 0 END), 0)::text AS valor
      FROM dna_work.pagamento_comissao p
      ${where}
    `, params);
    const rows = await many<{
      nome_fantasia: string | null; cnpj: string | null; vencimento_fatura: string | null; data_pg_comissao: string | null;
      valor: string | null; usuario: string | null; vendedor: string | null; treinamento: string | null; itens: number; status_boleto: number | null;
    }>(this.db, `
      SELECT p.nome_fantasia, p.cnpj, p.vencimento_fatura, p.data_pg_comissao,
             p."ValorFinalComissao"::text AS valor, p.usuario, p."VendedorBase" AS vendedor, p.treinamento,
             (SELECT count(*)::int FROM dna_work.pagamento_comissao_vagas v WHERE v.id_pagamento::text = p.id::text) AS itens,
             f.status_fatura AS status_boleto
      FROM dna_work.pagamento_comissao p
      LEFT JOIN dna_work.fatura f ON f.id_fatura::text = p.id_fatura::text
      ${where}
      ORDER BY p.ano DESC, p.mes DESC, p.nome_fantasia
      LIMIT $6 OFFSET $7
    `, [...params, tamanho, offset]);
    return {
      data: rows.map((item) => ({
        nome_fantasia: item.nome_fantasia,
        cnpj: item.cnpj,
        vencimento: item.vencimento_fatura,
        data_pg: item.data_pg_comissao,
        status_boleto: item.status_boleto === 1 ? "Pago" : item.status_boleto === 0 ? "Aberto" : "—",
        itens: item.itens,
        vendedor: item.vendedor || (item.usuario == null ? null : String(item.usuario)),
        treinamento: item.treinamento,
        valor: item.valor != null && item.valor !== "" ? Number(String(item.valor).replace(",", ".")) : null,
        status: item.data_pg_comissao ? "Pago" : "Aberta",
      })),
      meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho, totalReceber: Number(total?.valor ?? 0) },
    };
  }

  async comissaoEmpresas(query: { empresa?: string; consultor?: string; mes?: string; ano?: string; status?: string; page?: number; pageSize?: number }) {
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const empresa = texto(query.empresa);
    const consultor = texto(query.consultor);
    const mes = texto(query.mes);
    const ano = texto(query.ano);
    const status = texto(query.status);
    const where = `
      WHERE coalesce(e.forma_comissao, '') <> ''
        AND ($1 = '' OR e.nome_fantasia ILIKE $1 OR e.razao_social ILIKE $1 OR e.cnpj ILIKE $1)
        AND ($2 = '' OR u.u_nome ILIKE $2)
        AND ($3 = '' OR e.data_adicao::text LIKE $4 || '/' || lpad($3, 2, '0') || '%' OR e.data_adicao::text LIKE $4 || '-' || lpad($3, 2, '0') || '%')
        AND ($5 = '' OR ($5 = '1' AND pg.id IS NOT NULL) OR ($5 = '0' AND pg.id IS NULL))
    `;
    const params = [empresa ? `%${empresa}%` : "", consultor && consultor !== "todos" ? `%${consultor}%` : "", mes, ano || String(new Date().getFullYear()), status];
    const total = await one<{ total: number; valor: string }>(this.db, `
      SELECT count(*)::int AS total,
             coalesce(sum(CASE WHEN replace(coalesce(e.valor_comisao_empresa::text, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
                               THEN replace(e.valor_comisao_empresa::text, ',', '.')::numeric ELSE 0 END), 0)::text AS valor
      FROM dna_work.empresa e
      LEFT JOIN dna_work.usuario u ON u.u_id::text = e.usuario::text
      LEFT JOIN dna_work.fatura_pagamento_comissao_empresa pg
        ON pg.id_empresa::text = e.id_empresa::text
       AND ($3 = '' OR ltrim(pg.mes::text, '0') = ltrim($3, '0'))
       AND pg.ano::text = $4
      ${where}
    `, params);
    const rows = await many<{
      nome_fantasia: string | null; vendedor: string | null; data_adicao: string | null;
      primeira_contratacao: string | null; primeira_vaga: string | null; tipo: string | null; valor: string | null; pago: number | null;
    }>(this.db, `
      SELECT e.nome_fantasia, u.u_nome AS vendedor, e.data_adicao::text AS data_adicao,
             (SELECT min(c.data_contratacao) FROM dna_work.vaga v JOIN dna_work.conratacaovaga c ON c.id_vaga = v.id_vaga WHERE v.id_empresa = e.id_empresa) AS primeira_contratacao,
             (SELECT min(v.dataabertura) FROM dna_work.vaga v WHERE v.id_empresa = e.id_empresa) AS primeira_vaga,
             e.forma_comissao AS tipo, e.valor_comisao_empresa::text AS valor,
             pg.id AS pago
      FROM dna_work.empresa e
      LEFT JOIN dna_work.usuario u ON u.u_id::text = e.usuario::text
      LEFT JOIN dna_work.fatura_pagamento_comissao_empresa pg
        ON pg.id_empresa::text = e.id_empresa::text
       AND ($3 = '' OR ltrim(pg.mes::text, '0') = ltrim($3, '0'))
       AND pg.ano::text = $4
      ${where}
      ORDER BY e.nome_fantasia
      LIMIT $6 OFFSET $7
    `, [...params, tamanho, offset]);
    return {
      data: rows.map((item) => ({
        nome_fantasia: item.nome_fantasia,
        vendedor: item.vendedor,
        data_cadastro: item.data_adicao,
        primeira_contratacao: item.primeira_contratacao,
        primeira_vaga: item.primeira_vaga,
        tipo: item.tipo,
        valor: item.valor != null && item.valor !== "" ? Number(String(item.valor).replace(",", ".")) : null,
        status: item.pago ? "Pago" : "Aberta",
      })),
      meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho, totalReceber: Number(total?.valor ?? 0) },
    };
  }

  async holerite(query: { empresa?: string; mes?: string; ano?: string; page?: number; pageSize?: number }) {
    const mes = texto(query.mes) || String(new Date().getMonth() + 1).padStart(2, "0");
    const ano = texto(query.ano) || String(new Date().getFullYear());
    const inicio = `${ano}/${mes.padStart(2, "0")}/01`;
    const proximoMes = Number(mes) === 12 ? 1 : Number(mes) + 1;
    const proximoAno = Number(mes) === 12 ? Number(ano) + 1 : Number(ano);
    const fim = `${proximoAno}/${String(proximoMes).padStart(2, "0")}/01`;
    const empresa = texto(query.empresa);
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const where = `
      WHERE cv.datainicio <= $1
        AND (cv.data_demicao IS NULL OR cv.data_demicao = '' OR cv.data_demicao >= $2)
        AND ($3 = '' OR e.razao_social ILIKE $3 OR e.nome_fantasia ILIKE $3 OR e.cnpj ILIKE $3)
    `;
    const params = [inicio, fim, empresa ? `%${empresa}%` : ""];
    const total = await one<{ total: number }>(this.db, `
      SELECT count(*)::int AS total FROM (
        SELECT e.id_empresa
        FROM dna_work.conratacaovaga cv
        JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
        JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
        ${where}
        GROUP BY e.id_empresa
      ) lista
    `, params);
    const rows = await many<{ cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; candidatos: number }>(this.db, `
      SELECT e.cnpj, e.razao_social, e.nome_fantasia, count(DISTINCT cv.id_candidato)::int AS candidatos
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
      ${where}
      GROUP BY e.id_empresa, e.cnpj, e.razao_social, e.nome_fantasia
      ORDER BY e.nome_fantasia
      LIMIT $4 OFFSET $5
    `, [...params, tamanho, offset]);
    return { data: rows, meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho } };
  }

  async documentos(query: { modalidade?: string; empresa?: string; documento?: string; candidato?: string; de?: string; ate?: string; page?: number; pageSize?: number }) {
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 20);
    const modalidade = texto(query.modalidade);
    const empresa = texto(query.empresa);
    const documento = texto(query.documento);
    const candidato = texto(query.candidato);
    const de = texto(query.de).replaceAll("-", "/");
    const ate = texto(query.ate).replaceAll("-", "/");
    const where = `
      WHERE cg.status::text NOT IN ('3')
        AND cd.tipo = 'Candidato'
        AND cd.devolucao::text = '1'
        AND (cg.devolvido::text = '0' OR cg.devolvido IS NULL)
        AND ($1 = '' OR $1 = 'Todos' OR mv.descricao ILIKE $1)
        AND ($2 = '' OR e.razao_social ILIKE $2 OR e.nome_fantasia ILIKE $2)
        AND ($3 = '' OR $3 = 'Todos' OR cd.nome ILIKE $3)
        AND ($4 = '' OR c.nome ILIKE $4)
        AND ($5 = '' OR vencimento >= $5)
        AND ($6 = '' OR vencimento <= $6)
    `;
    const params = [
      modalidade && modalidade !== "Todos" ? modalidade : "",
      empresa ? `%${empresa}%` : "",
      documento && documento !== "Todos" ? `%${documento}%` : "",
      candidato ? `%${candidato}%` : "",
      de,
      ate,
    ];
    const vencimento = `
      CASE
        WHEN cd.recisao::text = '1' AND cv.status::text = '2' THEN cv.data_demicao
        WHEN cd.recisao::text = '1' THEN cg.datafim
        WHEN cg.data ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$' AND cd.dias::text ~ '^[0-9]+$'
          THEN to_char(to_date(cg.data, 'YYYY/MM/DD') + cd.dias::int, 'YYYY/MM/DD')
        ELSE cg.datafim
      END
    `;
    const from = `
      FROM dna_work.contratos_gerados cg
      JOIN dna_work.candidato c ON c.id_candidato = cg.id_candidato
      JOIN dna_work.contratos_diversos cd ON cd.id_contrato::text = cg.id_contrato::text
      JOIN dna_work.conratacaovaga cv ON cv.id_vaga::text = cg.vaga::text AND cv.id_candidato::text = c.id_candidato::text
      JOIN dna_work.vaga v ON v.id_vaga::text = cv.id_vaga::text
      JOIN dna_work.empresa e ON e.id_empresa::text = v.id_empresa::text
      LEFT JOIN dna_work.modalidade_vaga mv ON mv.id::text = v.tipo_vaga::text
      LEFT JOIN dna_work.assinatura_digital ad ON ad.id_contratogerado::text = cg.id_contratogerado::text
    `;
    const total = await one<{ total: number }>(this.db, `
      SELECT count(*)::int AS total FROM (
        SELECT cg.id_contratogerado, ${vencimento} AS vencimento
        ${from}
        ${where}
        GROUP BY cg.id_contratogerado, c.nome, cd.nome, e.nome_fantasia, e.razao_social, cg.datainicio, cv.datainicio, cv.status, v.tipo_vaga, mv.descricao, ad.id, e.instrucao, cd.recisao, cv.data_demicao, cg.datafim, cg.data, cd.dias
      ) lista
    `, params);
    const rows = await many<{
      nome: string | null; assinatura: string | null; vencimento: string | null; datainicio: string | null;
      modalidade: string | null; documento: string | null; empresa: string | null; status: string | null; instrucao: string | null;
    }>(this.db, `
      SELECT c.nome,
             CASE WHEN ad.id IS NULL THEN 'Manual' ELSE 'Digital' END AS assinatura,
             ${vencimento} AS vencimento,
             coalesce(cg.datainicio, cv.datainicio) AS datainicio,
             mv.descricao AS modalidade,
             cd.nome AS documento,
             coalesce(e.nome_fantasia, e.razao_social) AS empresa,
             CASE WHEN cv.status::text = '1' THEN 'Ativo' WHEN cv.status::text = '2' THEN 'Encerrado' ELSE cv.status::text END AS status,
             e.instrucao
      ${from}
      ${where}
      GROUP BY cg.id_contratogerado, c.nome, cd.nome, e.nome_fantasia, e.razao_social, cg.datainicio, cv.datainicio, cv.status, mv.descricao, ad.id, e.instrucao, cd.recisao, cv.data_demicao, cg.datafim, cg.data, cd.dias
      ORDER BY vencimento NULLS LAST, c.nome
      LIMIT $7 OFFSET $8
    `, [...params, tamanho, offset]);
    const hoje = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    return {
      data: rows.map((item) => {
        const vencimento = item.vencimento ?? "";
        const atraso = /^\d{4}\/\d{2}\/\d{2}$/.test(vencimento) && vencimento < hoje
          ? Math.round((Date.parse(hoje.replaceAll("/", "-")) - Date.parse(vencimento.replaceAll("/", "-"))) / 86400000)
          : 0;
        return { ...item, atraso };
      }),
      meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho },
    };
  }

  async modelos(query: { nome?: string; cargo?: string; modalidade?: string; page?: number; pageSize?: number }) {
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 50);
    const nome = texto(query.nome);
    const cargo = texto(query.cargo);
    const modalidade = texto(query.modalidade);
    const where = `
      WHERE ($1 = '' OR m.nome ILIKE $1)
        AND ($2 = '' OR m.cargo ILIKE $2)
        AND ($3 = '' OR $3 = 'Todos' OR mv.descricao ILIKE $3)
    `;
    const params = [nome ? `%${nome}%` : "", cargo ? `%${cargo}%` : "", modalidade && modalidade !== "Todos" ? modalidade : ""];
    const total = await one<{ total: number }>(this.db, `
      SELECT count(*)::int AS total
      FROM dna_work.vaga_modelo m
      LEFT JOIN dna_work.modalidade_vaga mv ON mv.id::text = m.tipo_vaga::text
      ${where}
    `, params);
    const rows = await many<{ id_modelo: number; nome: string | null; cargo: string | null; tipo: string | null }>(this.db, `
      SELECT m.id_modelo, m.nome, m.cargo, mv.descricao AS tipo
      FROM dna_work.vaga_modelo m
      LEFT JOIN dna_work.modalidade_vaga mv ON mv.id::text = m.tipo_vaga::text
      ${where}
      ORDER BY m.nome
      LIMIT $4 OFFSET $5
    `, [...params, tamanho, offset]);
    return { data: rows, meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho } };
  }

  async instituicoes(query: { q?: string; ensino?: string; conveniada?: string; cidade?: string; uf?: string; page?: number; pageSize?: number }) {
    const { pagina, tamanho, offset } = corte(query.page ?? 1, query.pageSize ?? 20);
    const q = texto(query.q);
    const ensino = texto(query.ensino);
    const conveniada = texto(query.conveniada);
    const cidade = texto(query.cidade);
    const uf = texto(query.uf);
    const where = `
      WHERE ($1 = '' OR i.razao_social ILIKE $1 OR i.nome_fantasia ILIKE $1 OR i.cnpj ILIKE $1 OR i.telefone ILIKE $1 OR i.email ILIKE $1)
        AND ($2 = '' OR $2 = 'Todos' OR i.tipo_encino = $2)
        AND ($3 = '' OR $3 = 'Todas' OR ($3 = 'Sim' AND c.convenio::text = '1') OR ($3 IN ('Não', 'Nao') AND (c.convenio::text = '0' OR c.convenio IS NULL)))
        AND ($4 = '' OR i.cidade ILIKE $4)
        AND ($5 = '' OR i.uf ILIKE $5)
    `;
    const params = [q ? `%${q}%` : "", ensino, conveniada, cidade ? `%${cidade}%` : "", uf ? `%${uf}%` : ""];
    const joins = `
      FROM dna_work.instituicao i
      LEFT JOIN LATERAL (
        SELECT convenio, data_inicio, data_termino
        FROM dna_work.instituicao_convenio c
        WHERE c.id_intituicao = i.id_instiduicao
        ORDER BY c.id_convenio DESC
        LIMIT 1
      ) c ON true
    `;
    const total = await one<{ total: number }>(this.db, `SELECT count(*)::int AS total ${joins} ${where}`, params);
    const rows = await many<{
      conveniada: string | null; data_inicio: string | null; data_termino: string | null; tipo_encino: string | null;
      parece: string | null; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null;
      bairro: string | null; cidade: string | null; uf: string | null;
    }>(this.db, `
      SELECT c.convenio::text AS conveniada, c.data_inicio, c.data_termino, i.tipo_encino, i.parece::text AS parece,
             i.cnpj, i.razao_social, i.nome_fantasia, i.bairro, i.cidade, i.uf
      ${joins}
      ${where}
      ORDER BY i.nome_fantasia NULLS LAST, i.razao_social
      LIMIT $6 OFFSET $7
    `, [...params, tamanho, offset]);
    return { data: rows, meta: { total: total?.total ?? 0, page: pagina, pageSize: tamanho } };
  }
}
