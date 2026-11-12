# Agente — Painel

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Tela inicial do sistema interno. Mostra os indicadores do período escolhido (7, 30, 90 dias ou intervalo de datas) comparados com o período anterior de mesmo tamanho: vagas abertas, contratações, candidatos cadastrados, empresas com movimento, origem dos candidatos nos processos, posições livres e as contratações mais recentes. No fim da página há o bloco "Origem dos candidatos", que lê o CRM DNA e as tabelas de rastreio (`public.tracker_*`). É só leitura: nada é gravado a partir desta tela.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/` | `DashboardPage` | `frontend/src/pages/DashboardPage.tsx` | Cards principais, gráficos de vagas x contratações, CLT/estágio, ranking de empresas, "Análise detalhada" (origem dnawork/empresa, conversão, posições), tabela "Contratações recentes" |
| `/` (seção no fim) | `OrigemDashboard` | `frontend/src/origem/OrigemDashboard.tsx` | "Origem dos candidatos": Lead de entrada, Atendimento, Processo seletivo realizado e Ganho, por canal/rede/campanha, com filtro próprio de período (7 dias, 1 mês, 3 meses ou datas) |

Não há abas. A página exige a permissão `painel` (`paginaDoCaminho("/")` devolve `"painel"`, `frontend/src/components/shell.tsx:85-88`).

## Arquivos

Frontend
- `frontend/src/pages/DashboardPage.tsx` — página, filtros de período, cards, gráficos (recharts), comparação com o período anterior (`Comparacao`, `variacao`, `faixaCurta`).
- `frontend/src/origem/OrigemDashboard.tsx`, `frontend/src/origem/date-range.ts`, `frontend/src/origem/origem.css` — bloco de origem (código trazido do app de candidaturas; usa `fetch` direto, não `api()`).
- `frontend/src/components/preview.tsx` (`PreviewFlutuante`, tooltip da comparação), `frontend/src/components/ui.tsx` (`Badge`, `Skeleton`, `cn`), `frontend/src/lib/format.ts` (`dateBr`, `regimeLabel`).

Backend
- `backend/src/routes/index.ts` — rotas `GET /api/v1/dashboard` (linha ~137) e `GET /api/v1/dashboard/origem` (linha ~122).
- `backend/src/services/dashboard.service.ts` — todas as contas do painel principal.
- `backend/src/lib/dashboard-periodo.ts` — `intervaloDe` (cálculo do período e do anterior), `VAGA_ABERTA = 0`, `DATA_LEGADO` (converte datas texto `YYYY/MM/DD`).
- `backend/src/lib/processo.ts` — `taxaConversao`.
- `backend/src/repositories/contratacao.repository.ts` — `recent()` (contratações recentes); `backend/src/services/presenters.ts` — `presentContratacao`.
- `backend/src/origem/*` — `cache.ts` (cache de 10 min), `resumo.ts` (monta a resposta), `crm-entradas.ts`, `crm-tracking.ts`, `crm-dna.ts` (cliente do CRM), `tracker-db.ts` (tabelas `public.tracker_*`), `ganhos-contratacoes.ts`, `date-range.ts` (limita a 3 meses), `lead-origin.ts`, `campaign-label.ts`, `tipo-vaga.ts`.
- `backend/src/app.ts` — hook `onRequest` que exige login e a página `painel` (via `paginasDaApi` em `backend/src/lib/paginas.ts`).

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/dashboard?dias=N` ou `?de=AAAA-MM-DD&ate=AAAA-MM-DD` | Indicadores do período e do período anterior | `routes/index.ts` → `DashboardService.get` |
| GET | `/api/v1/dashboard/origem?from=AAAA-MM-DD&to=AAAA-MM-DD` | Resumo de origem (leads, atendimentos, seletivo, ganhos) | `routes/index.ts` → `origemComCache` → `resumoOrigem` |

Os webhooks `POST /api/v1/webhooks/lead-criado` e `POST /api/v1/webhooks/ganho` (públicos, chamados pelo CRM/n8n) é que **gravam** em `public.tracker_leads` e `public.tracker_ganhos`; a tela só lê.

## Dados

Postgres, schema `dna_work.*` (cópia do Lightsail), só leitura:
- `dna_work.candidato` — total, `data_adicao` (cadastrados no período; sem data ficam fora).
- `dna_work.vaga` — `status` (0 = aberta), `dataabertura` (texto `YYYY/MM/DD`, com `data_adicao` como reserva), `quantidade_posicoes`, `id_empresa`, `tipo_vaga`.
- `dna_work.conratacaovaga` (grafia legada) — `data_contratacao` (texto), `status` (ativo = `CONTRATACAO_STATUS_ATIVO`, padrão 1), `id_vaga`, `id_empresa`.
- `dna_work.emcaminhamento` (grafia legada) — `data`, `id_vaga` ("Registro antigo de entrevistas, sem origem").
- `dna_work.empresa` — `nome_fantasia`, `razao_social` (ranking).
- `dna_work.modalidade_vaga` — `descricao` (gráfico CLT e estágio).
- `dna_work.processo_seletivo` — `origem` (`dnawork`/`empresa`), `data_encaminhamento`, `data_recebimento`, `id_contratacao`.
- `dna_work.processo_movimento` — `etapa = 'entrevista_realizada'`, `criado_em` (fuso America/Sao_Paulo).

Postgres, schema `public` (bloco Origem dos candidatos), só leitura:
- `public.tracker_leads` — `telefone_normalizado`, `origem`, `campanha`, `headline`, `referrer`, `tipo_vaga`.
- `public.tracker_ganhos` — `passagem` (`seletivo`, `ganho`, `atendimento`), `ganho_em`, `origem`, `campanha`, `tipo_vaga`.

Serviço externo: **CRM DNA** (`backend/src/origem/crm-dna.ts`), chamadas `GET /api/deals` (fase Lead de entrada), `/api/deals/:id/timeline`, `/api/contacts/:id`, `/api/contacts?phone=...`. Variáveis: `CRM_DNA_API_URL`/`CRM_DNA_API_TOKEN` (ou `CRM_BASE_URL`/`CRM_API_KEY`). Hosts antigos do CRM são trocados por `https://integrations.bwipo.com`.

## Regras e comportamentos importantes

- Período (`lib/dashboard-periodo.ts`): `dias` de 1 a 366 (padrão 30) termina no dia seguinte a hoje em São Paulo (fim exclusivo). Intervalo `de`/`ate` é inclusivo; precisa dos dois e `de <= ate`, senão 422 `INTERVALO_INVALIDO` (`dashboard.service.ts:27-31`). O período anterior tem o mesmo número de dias, imediatamente antes.
- No frontend, mexer numa data zera os botões de dias; a consulta só roda com as duas datas preenchidas (`DashboardPage.tsx:49-54`). O subtítulo mostra `fim - 1` porque o fim vem exclusivo.
- Datas do legado são texto: só entram se casarem com `^YYYY/MM/DD` (`DATA_LEGADO`). Datas em outro formato ficam fora das contas.
- "Vagas abertas no período" (card) = vagas **cadastradas** no período (`vagas_cadastradas`), qualquer status. A linha de baixo separa "vagas abertas agora" (status 0 hoje) e "vagas abertas com cadastro no período".
- "Empresas com movimentação" = união de empresas com vaga cadastrada, contratação ou encaminhamento no período (`dashboard.service.ts:113-119`).
- Comparação: diferença absoluta e % (`variacao`); % some quando o anterior é 0.
- Conversão = contratados da origem ÷ entradas da origem, 1 casa decimal; `null` quando não há entradas → "Dados indisponíveis" (`lib/processo.ts:28-31`).
- Contratações por origem: `dnawork`/`empresa` pelo `processo_seletivo` ligado à contratação; sem processo = "Não identificado".
- Posições disponíveis: soma de `quantidade_posicoes - contratações ativas` (mínimo 0) só das vagas abertas com quantidade preenchida; se nenhuma tiver quantidade, mostra "Dados indisponíveis" com o motivo.
- Ranking: top 8 empresas por contratações no período. Contratações recentes: as 8 mais recentes da base inteira (fora do período), ordenadas por `data_contratacao`, depois `datainicio`.
- Origem dos candidatos: período limitado a 3 meses e no máximo até hoje (`origem/date-range.ts` `clampOrigemRange`); sem datas usa 7 dias. Resposta guardada em memória por 10 minutos por período; erro não fica guardado (`origem/cache.ts`). A leitura do CRM tem limite de chamadas e pode demorar minutos.
- Com Postgres, "Ganho" = contratações do período (mesma conta do card), com a origem buscada em `tracker_leads` pelo telefone do candidato, depois no CRM, e senão "Só contrato" (`origem/ganhos-contratacoes.ts`).
- Permissão: `/api/v1/dashboard` e `/api/v1/dashboard/origem` exigem a página `painel` (prefixo em `lib/paginas.ts`) para quem não é admin.

## Cuidados ao mudar

- Os nomes dos campos da resposta de `/api/v1/dashboard` estão espelhados no tipo `Dashboard` de `DashboardPage.tsx:12-39`; mudou um lado, mude o outro.
- `DATA_LEGADO` e `VAGA_ABERTA` também são usados por `origem/ganhos-contratacoes.ts`; mudar a regra muda as duas contas.
- `ContratacaoRepository.recent` e `presentContratacao` são compartilhados com a área de Contratações.
- `/api/v1/dashboard/origem` responde em outro formato (`{ success, message, ... }` sem envelope `data`), por isso o `OrigemDashboard` usa `fetch` e lê `payload.message`; não troque por `api()` sem ajustar.
- O cache da origem é em memória do processo: reiniciar o backend limpa; várias instâncias não compartilham.
- A tabela `conratacaovaga` e `emcaminhamento` têm grafia errada de propósito (legado); não "corrija".
- Quem não tem a página `painel` cai na mensagem "Você não tem acesso a esta página." ao entrar em `/`, inclusive logo após o login.

## Como testar

- Abrir `/`, trocar 7/30/90 dias e um intervalo de datas; conferir o subtítulo e o tooltip da comparação.
- Rolar até "Origem dos candidatos" e trocar o período (precisa das variáveis do CRM; sem elas aparece erro).
- Testes: `backend/test/dashboard-periodo.test.ts` (cálculo do intervalo). Não encontrei teste do `DashboardService` nem do módulo `origem`.
- Comandos: `npm test -w backend`, `npm run lint -w backend`, `npm run lint -w frontend`.
