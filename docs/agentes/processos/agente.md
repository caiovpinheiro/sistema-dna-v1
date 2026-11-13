# Agente — Processos

> Última revisão: 2026-11-13 (commit "Repagina as telas restantes no padrão novo")

## Para que serve

Cada processo seletivo liga um candidato a uma vaga de uma empresa e diz **quem trouxe** o candidato: "Captado pela DNAWORK" ou "Enviado pela empresa". O usuário lista e filtra os processos, abre um processo novo escolhendo empresa, vaga e candidato, e anda com o processo pela trilha (recebido → encaminhado → entrevista agendada → entrevista realizada), ou encerra como reprovado ou desistente. A etapa "contratado" só é marcada pela contratação. Os processos alimentam a conversão do Painel e aparecem nas fichas de vaga e de candidato.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/processos` | `ProcessosPage` | `frontend/src/pages/ProcessosPage.tsx` | `CabecalhoPagina` com "Novo processo". Filtros com rótulo (Candidato, ao sair do campo ou com Enter; Origem; Etapa) na URL (`nome`, `origem`, `etapa`), contador + "Limpar filtros". Tabela `data-table` com Candidato, Empresa, Vaga, Origem e Etapa em selo, Recebido, Encaminhado e "Abrir", 30 por página. Vazio diferencia "nenhum processo" de "nenhum com esses filtros". |
| `/processos/novo` | `ProcessoFormPage` | `frontend/src/pages/ProcessoFormPage.tsx` | Três blocos numerados: 1 Empresa e vaga (busca a partir de 2 letras, vagas da empresa em cartões), 2 Candidato (busca pelo nome), 3 Origem e datas (origem em cartões de rádio, recebimento, encaminhamento obrigatório para DNAWORK, observação). Botão "Abrir processo" no fim. Aceita `?empresa=&vaga=&candidato=` já preenchidos. |
| `/processos/:id` | `ProcessoDetailPage` | `frontend/src/pages/ProcessoDetailPage.tsx` | Cabeçalho (candidato, selos de etapa e origem, contato, empresa, vaga, botão "Contratar" enquanto aberto). Card "Andamento" com a trilha de 5 etapas, os botões das próximas etapas mais Reprovado e Desistente (`acao-rose`) e o link da contratação. Cards "Datas" e "Histórico" (hora já vem de São Paulo do servidor; a tela só reformata), a `FichaCandidato` e os textos do atendimento (resumo da entrevista, condução, dados da vaga). |

Também usam esta seção:
- `ProcessosRelacionados` (exportado de `ProcessosPage.tsx`) aparece em `VagaDetailPage.tsx:191` (`id_vaga=`) e em `CandidatoDetailPage.tsx:67` (`id_candidato=`).
- "Novo processo" aparece em `VagaDetailPage.tsx:107` (`?vaga=&empresa=`) e em `CandidatoDetailPage.tsx:44` (`?candidato=`).

Menu: item único "Processos" em `frontend/src/components/shell.tsx:22`, página `processos`.

## Arquivos

**Frontend**
- `frontend/src/pages/ProcessosPage.tsx`: `ProcessosPage`, `ProcessosRelacionados`, `Lista`, `EtapaBadge` (selo da etapa, também usado no detalhe).
- `frontend/src/pages/ProcessoFormPage.tsx`
- `frontend/src/pages/ProcessoDetailPage.tsx`: `ProcessoDetailPage`, `Texto`. A trilha e as etapas finais estão repetidas no front (`trilha`, `finais`).
- `frontend/src/components/ficha-candidato.tsx`: `FichaCandidato` (a mesma da página do candidato).
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/pagina.tsx` (`CabecalhoPagina`, `CampoFiltro`, `ResumoResultados`, `Alerta`) e `frontend/src/lib/format.ts` (`etapaLabel`, `origemLabel`, `dateBr`, `formatCpf`, `formatPhone`, `textoPlano`).

**Backend**
- `backend/src/routes/index.ts:309-321`: rotas `/api/v1/processos`.
- `backend/src/services/processo.service.ts`: `list`, `get`, `create`, `mover`, `vincularContratacao`. Também tem as funções da integração de atendimento (`buscarCandidato`, `criarCandidato`, `atualizarCandidato`, `receberAtendimento`).
- `backend/src/repositories/processo.repository.ts`: SQL de `processo_seletivo` e `processo_movimento`.
- `backend/src/lib/processo.ts`: `ETAPAS`, `etapaInicial`, `podeMover`, `taxaConversao`.
- `backend/src/schemas/processo.ts`: `processoCreateSchema`, `processoMoverSchema`, `processoListSchema`, `atendimentoSchema`.
- `backend/src/services/candidato.service.ts`: `fichaDoCandidato`, que monta a ficha usada no detalhe e completa o `atendimento` do candidato com o dos processos.
- `backend/src/services/contratacao.service.ts:175`: chama `vincularContratacao` ao contratar.
- `backend/src/services/dashboard.service.ts` (linhas 72-73 e 188-216): conversão e séries do Painel a partir de `processo_seletivo`.
- `backend/src/app.ts:209-300`: rotas de serviço `/api/v1/servico/*` (sem login de usuário, com `x-service-token`), que criam candidatos e processos vindos do atendimento.
- Migrations: `prisma/migrations/20261025013000_processo_seletivo/migration.sql` e `prisma/migrations/20261030140000_processo_atendimento/migration.sql`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/processos?page&pageSize&nome&origem&etapa&id_empresa&id_vaga&id_candidato` | Lista paginada, mais recentes primeiro (`criado_em desc`). | routes:309 → `ProcessoService.list` → `ProcessoRepository.list` |
| POST | `/api/v1/processos` | Abre o processo. | routes:313 → `ProcessoService.create` |
| GET | `/api/v1/processos/:id` (uuid) | Processo, histórico e ficha do candidato (sem dados bancários). | routes:316 → `ProcessoService.get` |
| POST | `/api/v1/processos/:id/etapa` | Move a etapa (`{ etapa, observacao? }`). | routes:319 → `ProcessoService.mover` |
| GET | `/api/v1/empresas?pageSize=8&q=` | Busca a empresa no formulário. | routes:194 → `EmpresaService.list` |
| GET | `/api/v1/empresas/:id/vagas?pageSize=50` | Vagas da empresa (qualquer situação) no formulário. | routes:214 → `VagaService.list` |
| GET | `/api/v1/candidatos?pageSize=8&nome=` | Busca o candidato no formulário. | routes:159 → `CandidatoService.list` |
| GET/POST/PATCH | `/api/v1/servico/candidatos`, POST `/api/v1/servico/processos` | Integração de atendimento (header `x-service-token` = `SERVICE_TOKEN`). Nenhuma tela usa. | app.ts:226-300 → `buscarCandidato`, `criarCandidato`, `atualizarCandidato`, `receberAtendimento` |

## Dados

Tudo no **Postgres, schema `dna_work`**. As duas tabelas de processo existem só no sistema novo (migrations Prisma); não vêm do Lightsail.

- `dna_work.processo_seletivo`: `id` (uuid), `id_candidato`, `id_empresa`, `id_vaga`, `origem` (`dnawork`/`empresa`), `data_recebimento`, `data_encaminhamento`, `etapa` (CHECK com as 7 etapas), `id_contratacao`, `criado_em`, `atendimento` (jsonb).
  - Índice único `processo_seletivo_aberto (id_candidato, id_vaga)` **só para etapas abertas**: não pode haver dois processos em andamento do mesmo candidato na mesma vaga.
- `dna_work.processo_movimento`: `id`, `id_processo`, `etapa`, `observacao` (até 500), `criado_em`. É o histórico.
- Lidas no join: `dna_work.candidato` (`nome`), `dna_work.empresa` (`nome_fantasia`/`razao_social`), `dna_work.vaga` (`cargo`).
- `atendimento` (jsonb) é preenchido pela integração de serviço com `captado_por`, `resumo_cv`, `resumo_entrevista`, `descricao_vaga`, `teste_comportamental`, `info_conducao`, `escolaridade`, `idade`, `tipo_de_vaga` e `deal_id`. A tela de detalhe mostra `resumo_entrevista`, `info_conducao` e `descricao_vaga`.
- A integração de serviço também grava em `dna_work.candidato` (INSERT ou UPDATE de `nome`, `cpf`, `celular`, `email`, `cep`, `sexo`, `escola` e `atendimento` jsonb).
- Nenhum serviço externo é chamado pelas telas desta seção.

## Regras e comportamentos importantes

- **Etapa inicial** (`etapaInicial`, lib/processo.ts:17): origem `dnawork` começa em `encaminhado`. Origem `empresa` começa em `recebido`, ou em `encaminhado` se já veio com data de encaminhamento.
- **Validações ao criar** (schemas/processo.ts):
  - `dnawork` exige `data_encaminhamento`;
  - o encaminhamento não pode ser antes do recebimento;
  - observação até 500 caracteres.
- **Checagens do serviço ao criar**:
  - a vaga existe (`dna_work.vaga`) e pertence à empresa (409 `EMPRESA_DIVERGENTE`);
  - a empresa e o candidato existem (404);
  - se já existe processo aberto do candidato na vaga, devolve 409 `PROCESSO_ABERTO` (erro 23505 do índice único).
- **Observação**: a observação de criação vai só para o primeiro movimento (`processo_movimento`), não para uma coluna do processo (processo.repository.ts:57-63).
- **Mover** (`podeMover`, lib/processo.ts:22):
  - só para frente na trilha `recebido → encaminhado → entrevista_agendada → entrevista_realizada`;
  - `reprovado` e `desistente` podem ser aplicados de qualquer etapa aberta;
  - etapa final (`contratado`, `reprovado`, `desistente`) não muda mais;
  - pedir `contratado` dá 409 `ETAPA_PELA_CONTRATACAO`; outra etapa inválida dá 409 `ETAPA_INVALIDA`;
  - ir para `encaminhado` sem data grava a data de hoje (São Paulo);
  - todo movimento grava uma linha em `processo_movimento`.
- **Contratado**: o botão "Contratar" leva a `/contratacoes/nova?empresa&vaga&candidato&processo`. Ao salvar a contratação, `vincularContratacao` coloca o processo em `contratado`, grava `id_contratacao` e um movimento "Contratação vinculada.". Erros possíveis: o processo informado é de outro candidato ou de outra vaga (409 `PROCESSO_DIVERGENTE`), ou já está encerrado (409 `PROCESSO_ENCERRADO`). Sem `id_processo`, vincula o processo aberto do candidato na vaga, se houver.
- **Ficha no detalhe**: `fichaDoCandidato` sem os campos bancários e de Pix (processo.service.ts:68-71).
- **Painel**: `conversao_dnawork` = contratados DNAWORK / encaminhados; `conversao_empresa` = contratados da empresa / recebidos (`taxaConversao`, null quando não houve entrada).
- **Permissão**: `/api/v1/processos` exige a página `processos` (lib/paginas.ts). O formulário, porém, chama `/api/v1/empresas` (página `empresas`) e `/api/v1/candidatos` (página `candidatos`). Quem só tem `processos` recebe 403 nessas buscas e não consegue montar um processo novo.

## Cuidados ao mudar

- As etapas existem em cinco lugares: `lib/processo.ts` (`ETAPAS`, `TRILHA`, `FINAIS`), o CHECK da migration, `ProcessoDetailPage.tsx` (`trilha`, `finais`), `etapaLabel` em `format.ts` e `ETAPA_BADGE` em `ProcessosPage.tsx`. Etapa nova precisa de migration e dos cinco.
- O índice único parcial é o que impede processo duplicado. `create` e `receberAtendimento` dependem do erro 23505.
- `vincularContratacao` roda dentro da transação da contratação (`client`). Lançar erro ali desfaz a contratação inteira.
- `ProcessosRelacionados` usa a mesma `queryKey` base (`["processos", filtro]`) que a lista. É usado nas fichas de vaga e de candidato.
- O Painel (`dashboard.service.ts`) conta por `origem`, `data_encaminhamento`, `data_recebimento` e `id_contratacao`. Mudar o significado dessas colunas muda os números do Painel.
- `processo_seletivo.atendimento` também é lido por `fichaDoCandidato` para completar o atendimento do candidato. Não renomeie as chaves do jsonb.
- As rotas `/api/v1/servico/*` ficam fora do login (lista de exceções em app.ts:154) e dependem só do `SERVICE_TOKEN`.
- As três páginas seguem o padrão de Vagas/Empresas (`Card`, `CabecalhoPagina`, `data-table`, `Badge`) e só usam classes com remapeamento de tema em `index.css`; não volte a usar cores fixas como `bg-[#12141a]`.
- Cores dos selos de etapa ficam em `ETAPA_BADGE` (`ProcessosPage.tsx`). Etapa nova precisa de uma entrada ali também (sem ela o selo fica cinza).
- `ProcessosRelacionados` (fichas de vaga e de candidato) mostra "Nenhum processo seletivo registrado." quando vem vazio.

## Como testar

- `/processos`: filtre por origem e etapa, digite um nome e saia do campo, e confira a paginação.
- `/processos/novo`: busque a empresa, escolha a vaga e o candidato, e abra com origem "Captado pela DNAWORK" sem data de encaminhamento (deve recusar). Depois abra de novo o mesmo candidato na mesma vaga (deve dar "já tem um processo em andamento").
- `/processos/:id`: avance as etapas, marque Reprovado e confira que os botões somem e o histórico registra. Use "Contratar" e confira que o processo vira "Contratado" com link para a contratação.
- Teste do backend: `backend/test/processo.test.ts` (etapa inicial, trilha, conversão).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
