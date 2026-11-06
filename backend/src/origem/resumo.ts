import { resposta, type Resposta } from './resposta.js';
import {
  listPassagensAtendimento,
  listPassagensEnviadas,
  listPassagensGanhos,
  listTrackerLeads,
  listTrackerRedes,
  type PassagemEnviadaRow,
  type TrackerLeadRow,
} from './tracker-db.js';
import { campaignDisplayName, isNamedCampaign } from './campaign-label.js';
import { listEntradasCrm, type EntradaCrm } from './crm-entradas.js';
import { clampOrigemRange } from './date-range.js';
import { canalDeOrigem, mergeLeadTracking } from './lead-origin.js';
import { tipoSalvo, type TipoVaga } from './tipo-vaga.js';


function readDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function juntarEntradas(entradas: EntradaCrm[], rows: TrackerLeadRow[]) {
  const porTelefone = new Map(rows.map((row) => [row.telefone_normalizado, row]));
  const vistos = new Set<string>();
  const contas: ContaOrigem[] = [];

  for (const entrada of entradas) {
    const lead = entrada.telefoneNormalizado
      ? porTelefone.get(entrada.telefoneNormalizado)
      : undefined;
    const junto = lead
      ? mergeLeadTracking(entrada, {
          origem: lead.origem,
          campanha: lead.campanha,
          headline: lead.headline,
          ctwa_clid: null,
          fbclid: null,
          gclid: null,
          referrer: lead.referrer,
        })
      : entrada;
    contas.push({
      origem: junto.origem,
      campanha: junto.campanha,
      headline: junto.headline || lead?.headline || null,
      referrer: junto.referrer || lead?.referrer || null,
      tipo: tipoSalvo(lead?.tipo_vaga),
    });
    if (entrada.telefoneNormalizado) vistos.add(entrada.telefoneNormalizado);
  }

  for (const row of rows) {
    if (vistos.has(row.telefone_normalizado)) continue;
    contas.push({
      origem: row.origem,
      campanha: row.campanha,
      headline: row.headline,
      referrer: row.referrer,
      tipo: tipoSalvo(row.tipo_vaga),
    });
  }

  return contas;
}

interface ContaOrigem {
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  referrer?: string | null;
  origemSalva?: string | null;
  tipo?: TipoVaga | null;
}

function resumirContas(contas: ContaOrigem[]) {
  const origemCount = new Map<string, number>();
  const redeCount = new Map<string, number>();
  const campanhaCount = new Map<string, number>();
  let clt = 0;
  let estagio = 0;
  for (const row of contas) {
    if (row.tipo === 'clt') clt += 1;
    if (row.tipo === 'estagio') estagio += 1;
    const classe = canalDeOrigem(row.origem, row.referrer, row.origemSalva);
    origemCount.set(classe.canal, (origemCount.get(classe.canal) || 0) + 1);
    if (classe.canal === 'meta') {
      const rede = classe.rede || 'Não identificado';
      redeCount.set(rede, (redeCount.get(rede) || 0) + 1);
    }
    const campanha = campaignDisplayName(row.campanha, row.headline);
    const nome = isNamedCampaign(campanha) ? campanha : 'Sem campanha';
    const rede = classe.rede || classe.canal;
    const key = `${rede}||${nome}`;
    campanhaCount.set(key, (campanhaCount.get(key) || 0) + 1);
  }
  const total = contas.length;
  const meta = origemCount.get('meta') || 0;
  const ordemRede = ['Instagram', 'Facebook', 'Não identificado'];
  return {
    total,
    clt,
    estagio,
    origens: Array.from(origemCount.entries())
      .map(([nome, quantidade]) => ({
        nome,
        quantidade,
        percentual: total ? Number(((quantidade / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.quantidade - a.quantidade),
    redes: ordemRede
      .filter((nome) => redeCount.has(nome))
      .map((nome) => {
        const quantidade = redeCount.get(nome) || 0;
        return {
          nome,
          quantidade,
          percentual: meta ? Number(((quantidade / meta) * 100).toFixed(1)) : 0,
        };
      }),
    campanhas: Array.from(campanhaCount.entries())
      .map(([key, quantidade]) => {
        const [origem, campanha] = key.split('||');
        return { origem, campanha, quantidade };
      })
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 12),
  };
}

function contasDePassagens(
  rows: PassagemEnviadaRow[],
  redes: Map<string, { origem: string | null; referrer: string | null }>
) {
  const vistos = new Set<string>();
  const contas: ContaOrigem[] = [];
  for (const row of rows) {
    const chave = row.telefone_normalizado || row.id;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const salvo = row.telefone_normalizado ? redes.get(row.telefone_normalizado) : undefined;
    contas.push({
      origem: row.origem,
      campanha: row.campanha,
      headline: null,
      referrer: salvo?.referrer || null,
      origemSalva: salvo?.origem || null,
      tipo: tipoSalvo(row.tipo_vaga),
    });
  }
  return contas;
}

export async function resumoOrigem(fromRaw: string | null, toRaw: string | null): Promise<Resposta> {
  try {
    const { from, to } = clampOrigemRange(
      readDate(fromRaw),
      readDate(toRaw)
    );
    const [entradas, rows, ganhosPassagens, enviadas, atendimentos] = await Promise.all([
      listEntradasCrm({ from, to }),
      listTrackerLeads({ from, to }),
      listPassagensGanhos({ from, to }),
      listPassagensEnviadas({ from, to }),
      listPassagensAtendimento({ from, to }),
    ]);
    const contas = juntarEntradas(entradas, rows);
    const leads = resumirContas(contas);
    const telefones = [...ganhosPassagens, ...enviadas, ...atendimentos]
      .map((row) => row.telefone_normalizado)
      .filter((phone): phone is string => Boolean(phone));
    const redesSalvas = await listTrackerRedes(telefones);
    const porTelefone = new Map(redesSalvas.map((row) => [row.telefone_normalizado, row]));

    return resposta({
      success: true,
      ...leads,
      ganhos: resumirContas(contasDePassagens(ganhosPassagens, porTelefone)),
      enviadas: resumirContas(contasDePassagens(enviadas, porTelefone)),
      atendimentos: resumirContas(contasDePassagens(atendimentos, porTelefone)),
    });
  } catch (error) {
    console.error('Erro ao listar tracker_leads:', error);
    return resposta(
      { success: false, message: 'Erro ao carregar a origem dos candidatos.' },
      { status: 500 }
    );
  }
}
