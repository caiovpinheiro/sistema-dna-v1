# Agentes por página

Cada seção do menu tem um `agente.md` com o que um agente (ou pessoa) precisa saber antes de mexer nela: para que serve, rotas e abas, arquivos, API, dados, regras, cuidados e como testar. Seções com várias abas (por exemplo Vagas, com Consultar e Consultar Modelos) têm um único `agente.md`.

## Regra

Toda vez que uma página for criada ou alterada, o `agente.md` da seção dela é atualizado no mesmo commit, incluindo a linha "Última revisão". Página nova entra também na tabela abaixo. A regra completa está no [CLAUDE.md](../../CLAUDE.md) da raiz.

Para conferir se alguma página ficou sem agente:

```bash
npm run agentes:conferir
```

## Mapa: arquivo da página → agente

O script `scripts/conferir-agentes.mjs` lê esta tabela. Mantenha o formato: uma linha por arquivo de `frontend/src/pages`.

| Arquivo da página | Agente |
| --- | --- |
| DashboardPage.tsx | [painel](painel/agente.md) |
| LoginPage.tsx | [login](login/agente.md) |
| ConfiguracoesPage.tsx | [configuracoes](configuracoes/agente.md) |
| MetricasPage.tsx | [metricas](metricas/agente.md) |
| EmailsPage.tsx | [emails](emails/agente.md) |
| CandidatosPage.tsx | [candidatos](candidatos/agente.md) |
| CandidatoFormPage.tsx | [candidatos](candidatos/agente.md) |
| CandidatoDetailPage.tsx | [candidatos](candidatos/agente.md) |
| EmpresasPage.tsx | [empresas](empresas/agente.md) |
| EmpresaDetailPage.tsx | [empresas](empresas/agente.md) |
| EmpresaFormPage.tsx | [empresas](empresas/agente.md) |
| GruposEmpresasPage.tsx | [grupos-empresas](grupos-empresas/agente.md) |
| TriagemPage.tsx | [triagem](triagem/agente.md) |
| DossiePage.tsx | [triagem](triagem/agente.md) |
| VagasPage.tsx | [vagas](vagas/agente.md) |
| VagaDetailPage.tsx | [vagas](vagas/agente.md) |
| VagaFormPage.tsx | [vagas](vagas/agente.md) |
| ProcessosPage.tsx | [processos](processos/agente.md) |
| ProcessoFormPage.tsx | [processos](processos/agente.md) |
| ProcessoDetailPage.tsx | [processos](processos/agente.md) |
| ContratacoesPage.tsx | [contratacoes](contratacoes/agente.md) |
| NovaContratacaoPage.tsx | [contratacoes](contratacoes/agente.md) |
| ContratacaoDetailPage.tsx | [contratacoes](contratacoes/agente.md) |
| RescisaoPage.tsx | [contratacoes](contratacoes/agente.md) |
| RescisaoDetailPage.tsx | [contratacoes](contratacoes/agente.md) |
| TermosPage.tsx | [termos](termos/agente.md) |
| TermoDetailPage.tsx | [termos](termos/agente.md) |
| GerarDocumentoPage.tsx | [termos](termos/agente.md) |
| FinanceiroPage.tsx | [financeiro](financeiro/agente.md), [comissao](comissao/agente.md) |
| ContasReceberPage.tsx | [financeiro](financeiro/agente.md) |
| ReguaCobrancaPage.tsx | [financeiro](financeiro/agente.md) |
| NovasAbasPage.tsx | [vagas](vagas/agente.md), [documentos-pendentes](documentos-pendentes/agente.md), [instituicoes](instituicoes/agente.md) |

`NovasAbasPage.tsx` guarda várias telas: Consultar Modelos (vagas), Documentos pendentes e Instituições. `FinanceiroPage.tsx` guarda Faturamento, Relatório Procfy e Holerite (financeiro) e as duas telas de Comissão.
