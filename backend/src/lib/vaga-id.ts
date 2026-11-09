import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * O vaga_id de `public.vaga` (Postgres) junta só as vagas repetidas:
 * mesma empresa e todos os detalhes iguais. Empresa diferente ou qualquer detalhe diferente, vaga_id diferente.
 * Endereço, CEP e coordenadas vêm da empresa, então já entram pela empresa.
 */
const CAMPOS_ASSINATURA = [
  "empresa_id", "tipo_vaga", "cargo", "cargo_id", "descricao", "requisitos", "salario", "carga_horaria", "escolaridade", "sexo",
  "idade", "idade_ate", "km", "atividades", "tempo", "horario", "turno", "beneficios", "conducoes", "jornada", "tipo_trabalho",
] as const;
const NUMERICOS = new Set(["tipo_vaga", "salario", "idade", "idade_ate", "km"]);

export function assinaturaDaVaga(linha: Record<string, unknown>) {
  return JSON.stringify(CAMPOS_ASSINATURA.map((campo) => {
    const valor = linha[campo];
    if (valor == null || String(valor).trim() === "") return null;
    if (NUMERICOS.has(campo)) {
      const numero = Number(String(valor).replace(",", "."));
      return Number.isFinite(numero) ? numero : String(valor).trim();
    }
    return String(valor).trim();
  }));
}

export type MudancaVagaId = { id: string; de: string | null; para: string };

/**
 * Recalcula o vaga_id de todas as vagas de `public.vaga` pela regra acima. Grava só no Postgres: o Supabase não muda.
 * Cada grupo de vagas iguais fica com o vaga_id que a maioria já tinha (desde que outro grupo maior não o use);
 * sem um disponível, recebe um novo. Assim os vaga_id já enviados aos candidatos mudam o mínimo possível.
 */
export async function reagruparVagaIds(db: Pool, dry = false): Promise<MudancaVagaId[]> {
  const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM public.vaga ORDER BY id");
  const grupos = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const chave = assinaturaDaVaga(row);
    const lista = grupos.get(chave) ?? [];
    lista.push(row);
    grupos.set(chave, lista);
  }

  // Candidatos de cada grupo: os vaga_id atuais, do mais usado para o menos usado.
  const pedidos = [...grupos.values()].map((lista) => {
    const contagem = new Map<string, number>();
    for (const row of lista) {
      const atual = row.vaga_id == null ? "" : String(row.vaga_id);
      if (atual) contagem.set(atual, (contagem.get(atual) ?? 0) + 1);
    }
    return { lista, candidatos: [...contagem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
  });
  // Quem tem mais vagas com o mesmo vaga_id escolhe primeiro.
  pedidos.sort((a, b) => (b.candidatos[0]?.[1] ?? 0) - (a.candidatos[0]?.[1] ?? 0) || b.lista.length - a.lista.length);

  const usados = new Set<string>();
  const novoPorId = new Map<string, string>();
  for (const { lista, candidatos } of pedidos) {
    const escolhido = candidatos.map(([id]) => id).find((id) => !usados.has(id)) ?? randomUUID();
    usados.add(escolhido);
    for (const row of lista) novoPorId.set(String(row.id), escolhido);
  }

  const mudancas: MudancaVagaId[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const para = novoPorId.get(id)!;
    const de = row.vaga_id == null ? null : String(row.vaga_id);
    if (de === para) continue;
    mudancas.push({ id, de, para });
    if (!dry) await db.query("UPDATE public.vaga SET vaga_id = $2 WHERE id = $1", [id, para]);
  }
  return mudancas;
}
