# Agente — Contratações

> Última revisão: 2026-11-13 (commit "Corrige faturamento Todas, nomes com &amp;, rescisão pela ficha e cadastro de instituição")

## Para que serve

Registra o vínculo (contratação) de um candidato numa vaga aberta com posição livre, consulta os vínculos e encerra (demite) quem está ativo. Na aba Rescisão o usuário preenche motivo, data, avaliação e resumo, gera o documento de rescisão (PDF) e pode mandá-lo para assinatura digital na ZapSign. Contratações de estágio têm atalho para o gerador de TCE (seção Termos).

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/contratacoes` (menu "Consultar") | `ContratacoesPage` | `frontend/src/pages/ContratacoesPage.tsx` | Título "Contratações" com o botão "Nova contratação". Filtros com rótulo (Buscar, Regime, Situação, Início a partir de, Início até) gravados na URL (`q`, `regime`, `status`, `inicio_de`, `inicio_ate`); a busca aplica ao sair do campo ou com Enter. Contador + "Limpar filtros". Tabela `data-table` (lg+): candidato (link, CPF e nº embaixo), empresa (fantasia e razão), vaga (modalidade embaixo só se diferente do regime), regime em selo, início, fim (encerramento ou previsão), situação em selo e "Abrir". Em tela estreita vira lista em blocos. Paginação fixa de 20. |
| `/contratacoes/nova` | `NovaContratacaoPage` | `frontend/src/pages/NovaContratacaoPage.tsx` | Blocos numerados (1 Empresa, 2 Vaga disponível, 3 Candidato com "Criar candidato") e painel lateral "Registrar a contratação" com o resumo do que foi escolhido, a data de início e o botão "Registrar contratação". Tela de sucesso com links para candidato, vaga e empresa e "Abrir contratação". Aceita `?empresa=&vaga=&candidato=&processo=` (vem de `ProcessoDetailPage` e `VagaDetailPage`). |
| `/contratacoes/:id` | `ContratacaoDetailPage` | `frontend/src/pages/ContratacaoDetailPage.tsx` | Cabeçalho com nome, selos de situação e regime e o botão "Gerar TCE" (só regime estágio). Cards "Vínculo" (candidato, empresa e vaga como links) e "Datas", tabela "Documentos gerados" e card "Encerrar vínculo" (só se ativa) com o botão "Fazer a rescisão", que leva a `/contratacoes/rescisao/:id`: o encerramento passa sempre pela rescisão (data, motivo, avaliação e prévia), que gera o documento. A ficha não encerra mais só com a data. |
| `/contratacoes/rescisao` (menu "Rescisão") | `RescisaoPage` | `frontend/src/pages/RescisaoPage.tsx` | Só vínculos ativos (`status=1` fixo na query). Filtros com rótulo (Buscar, Regime), contador, tabela `data-table` com "Abrir" (lista em blocos em tela estreita). |
| `/contratacoes/rescisao/:id` | `RescisaoDetailPage` | `frontend/src/pages/RescisaoDetailPage.tsx` | Cabeçalho com nome, selos e "Abrir contratação"; card "Dados do contratado"; formulário "Demitir" (motivo, data, avaliação em chips `FiltroChips`, resumo das atividades, motivo interno), botões "Gerar rescisão e demitir" e "Ver prévia" (só na tela); depois modal perguntando se envia para assinatura digital ("Sim, enviar" / "Não, agora não"). |
Permissão de menu/página: id `contratacoes` (`frontend/src/components/shell.tsx:24-27`, `:79-80`).

## Arquivos

Frontend
- `frontend/src/pages/ContratacoesPage.tsx`, `NovaContratacaoPage.tsx`, `ContratacaoDetailPage.tsx`, `RescisaoPage.tsx`, `RescisaoDetailPage.tsx`
- `frontend/src/components/documentos-contratacao.tsx` — tabela "Documentos gerados" (`data-table`, assinatura em selo) + painel de assinatura ZapSign (tabela de partes, "Copiar link", "Enviar para assinatura", "Imprimir original", "Ver assinaturas na ZapSign"; usado na ficha e na rescisão)
- `frontend/src/components/pagina.tsx` (`CabecalhoPagina`, `CampoFiltro`, `ResumoResultados`, `FiltroChips`, `Alerta`)
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui.tsx`
- `frontend/src/lib/api.ts` (`api`, `ApiError`, `idempotencyKey`), `frontend/src/lib/format.ts` (`regimeLabel`, `situacaoLabel`, `dateBr`, `money`, `textoPlano`)

Backend
- Rotas: `backend/src/routes/index.ts:275-307` (contratações), `:881-886` (webhook ZapSign)
- Schemas: `backend/src/schemas/contratacao.ts`
- Service: `backend/src/services/contratacao.service.ts`; `backend/src/services/presenters.ts` (`presentContratacao`, calcula `regime` e `situacao`); `backend/src/services/processo.service.ts` (`vincularContratacao`)
- Repositories: `backend/src/repositories/contratacao.repository.ts`, `vaga.repository.ts`, `candidato.repository.ts`, `processo.repository.ts`
- Libs: `backend/src/lib/rescisao-pdf.ts` (PDF com pdf-lib), `backend/src/lib/zapsign.ts`, `backend/src/lib/vaga-status.ts`, `backend/src/lib/normalize.ts` (`classifyRegime`), `backend/src/lib/dates.ts`
- Checagem de schema: `backend/src/db/capabilities.ts`
- Permissão por API: `backend/src/lib/paginas.ts`, hook em `backend/src/app.ts:151-167`

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/contratacoes` | Lista com filtros `q`, `regime`, `status`, `inicio_de`, `inicio_ate`, `id_empresa`, `id_vaga`, `id_candidato`, paginação | `routes/index.ts:279` → `ContratacaoService.list` → `ContratacaoRepository.list` |
| GET | `/api/v1/contratacoes/:id` | Detalhe | `routes/index.ts:283` → `ContratacaoService.get` |
| POST | `/api/v1/contratacoes` | Cria vínculo. Exige cabeçalho `Idempotency-Key` (8–120 chars) | `routes/index.ts:275` → `ContratacaoService.create` |
| POST | `/api/v1/contratacoes/:id/encerrar` | Encerra; se vier `motivo`, grava o documento de rescisão | `routes/index.ts:289` → `ContratacaoService.encerrar` |
| GET | `/api/v1/contratacoes/:id/documentos` | Rescisão gerada + contratos do sistema antigo | `routes/index.ts:286` → `ContratacaoService.documentos` |
| GET | `/api/v1/contratacoes/:id/rescisao.pdf` | PDF da rescisão (inline) | `routes/index.ts:296` → `pdfRescisao` |
| GET | `/api/v1/contratacoes/:id/assinatura` | Consulta a ZapSign (se já enviado) e devolve status e signatários | `routes/index.ts:302` → `acompanharAssinatura` |
| POST | `/api/v1/contratacoes/:id/assinatura` | Cria o documento na ZapSign (ou só consulta, se já tem token) | `routes/index.ts:305` → `solicitarAssinatura` |
| POST | `/api/v1/zapsign/webhook` | Público (sem login). Atualiza termo e rescisão pelo `token` | `routes/index.ts:881` → `TermoService.receberWebhook` + `ContratacaoService.receberAssinatura` |
| GET | `/api/v1/empresas?pageSize=8&q=` | Busca de empresa (Nova contratação) | ver agente de Empresas |
| GET | `/api/v1/empresas/:id/vagas?pageSize=100&situacao=aberta` | Vagas da empresa | ver agente de Empresas/Vagas |
| GET / POST | `/api/v1/candidatos?pageSize=8&nome=` / `/api/v1/candidatos` | Busca / cria candidato rápido (nome, cpf, email) | ver agente de Candidatos |
| GET | `/api/v1/candidatos/:id`, `/api/v1/vagas/:id` | Rescisão: dados do candidato e texto das atribuições da vaga | ver agentes de Candidatos/Vagas |

Respostas seguem o envelope `{ success, data, meta }`.

## Dados

Banco: Postgres, schema `dna_work` (cópia do Lightsail). Nenhuma escrita no MySQL do Lightsail neste fluxo (não encontrado).

- `dna_work.conratacaovaga` (nome com erro de digitação, é o real) — lida e gravada. Campos: `id_contratacao` (sequence `conratacaovaga_id_contratacao_seq`), `id_vaga`, `id_candidato`, `id_empresa`, `data_contratacao`, `datainicio`, `datafim`, `data_demicao`, `status` (1 ativa / 2 encerrada por padrão), `contador`, `comparador`. Datas no formato legado `AAAA/MM/DD` (convertidas em `lib/dates.ts`).
- `dna_work.colaborador` — insere um registro por contratação (`id_colaborador` UUID, `id_contratacao`, cargo, salário, carga etc.); no encerramento muda `status_colaborador`.
- `dna_work.candidato` — `colaborador` (1/0), `id_empresa`, `ultimaalteracao` atualizados na contratação e no encerramento.
- `dna_work.vaga` — lida e travada (`FOR UPDATE`); `quantidade_posicoes` vira 1 se estiver nula; `status` vira `VAGA_STATUS_OCUPADA` quando a última posição é preenchida.
- `dna_work.processo_seletivo` — etapa vira `contratado` e recebe `id_contratacao` (com movimento registrado).
- `dna_work.api_idempotencia` — `chave`, `request_hash`, `status_code`, `response` da criação.
- `dna_work.rescisao_documento` — uma linha por contratação (`id_contratacao` UNIQUE): `nome`, `motivo`, `motivo_interno`, `avaliacao`, `resumo`, `data_demissao`, `cargo`, `empresa`, `texto`, `assinatura`, `zapsign_token`, `sign_url`, `signatarios` (JSON em texto), `preview_url`, `enviado_em`. Tabela/colunas criadas em tempo de execução por `garantirRescisao` (`contratacao.repository.ts:134-157`) e também pela migration `prisma/migrations/20261028150000_rescisao_documento`.
- Somente leitura: `dna_work.empresa`, `dna_work.modalidade_vaga`, `dna_work.instituicao` (diretor/e-mail da escola), `dna_work.agente_integracao` (signatário "Agente"), `dna_work.contratos_gerados`, `assinatura_digital`, `texto_contrato`, `usuario` (documentos históricos).

Serviço externo: **ZapSign** (`lib/zapsign.ts`), variáveis `ZAPSIGN_API_URL`, `ZAPSIGN_API_TOKEN`, `ZAPSIGN_USER_TOKEN`, `ZAPSIGN_AGENTE_ID` (vira `folder_path`). Outras variáveis: `CONTRATACAO_STATUS_ATIVO`, `CONTRATACAO_STATUS_ENCERRADO`, `COLABORADOR_STATUS_ATIVO`, `COLABORADOR_STATUS_INATIVO`, `VAGA_STATUS_OCUPADA`, `ALLOW_MULTIPLE_ACTIVE_LINKS` (`backend/src/config.ts:23-37`).

## Regras e comportamentos importantes

Criação (`contratacao.service.ts:93-207`, tudo numa transação):
- Idempotência: mesma chave + mesmo corpo devolve a resposta gravada; mesma chave com corpo diferente → 409 `IDEMPOTENCIA_DIVERGENTE`. O frontend gera uma chave nova a cada clique (`crypto.randomUUID()`).
- Advisory lock por candidato e `FOR UPDATE` na vaga (evita estourar posições em concorrência).
- Vaga precisa existir e ter empresa (404), `id_empresa` informado tem de ser o dono (409 `EMPRESA_DIVERGENTE`), status precisa ser "aberta" pelo mapa de `lib/vaga-status.ts` (códigos 0, 3, 4, 5, 9) senão 409 `VAGA_ENCERRADA`.
- Regime vem de `modalidade_vaga.descricao` via `classifyRegime`: só "estágio" ou "clt"; outro → 422 `MODALIDADE_NAO_SUPORTADA`.
- 409 `VINCULO_DUPLICADO` se já ativo na mesma vaga; 409 `CANDIDATO_JA_ATIVO` se ativo em outra vaga e `ALLOW_MULTIPLE_ACTIVE_LINKS` for falso.
- Capacidade = `quantidade_posicoes ?? 1`; cheia → 409 `VAGA_SEM_POSICAO`. Ao ocupar a última, vaga vai para `VAGA_STATUS_OCUPADA`.
- `id_contratacao`: antes do `nextval`, faz `setval` com o maior id existente (sync do legado grava ids explícitos) — `contratacao.repository.ts:103-117`.
- Com `id_processo`, o processo precisa ser do mesmo candidato/vaga e não estar encerrado (409 `PROCESSO_DIVERGENTE`/`PROCESSO_ENCERRADO`); sem `id_processo`, vincula o processo aberto mais recente do par candidato+vaga, se houver.
- Se faltar migration (`vaga.quantidade_posicoes`, sequence, `colaborador.id_contratacao`, `api_idempotencia`), `create/encerrar/documentos/assinatura` respondem erro de migration pendente (`ensureReady`).

Encerramento (`contratacao.service.ts:311-369`):
- Só status ativo; já encerrada ou com `data_demicao` → 409 `JA_ENCERRADA`.
- Grava `status` encerrado, `data_demicao` e preenche `datafim` se estava vazia. Colaborador fica inativo; `candidato.colaborador = 0` só se não houver outro vínculo ativo.
- **Não reabre a vaga** (não mexe em `vaga.status`).
- Só cria/atualiza `rescisao_documento` se vier `motivo`. A ficha (`ContratacaoDetailPage`) encerra sem motivo → não gera rescisão. A tela Rescisão sempre manda motivo (um de dois textos fixos) e a avaliação (`Excelente`, `Muito bom`, `Bom`, `Regular`, `Insuficiente`).
- Nome do documento: `tipo_vaga === 1` → "Rescisão de estágio", senão "Rescisão CLT" (`:329`).
- O resumo é pré-preenchido no frontend com `atribu_contrato` (ou `atribuicaoes`) da vaga, sem HTML.

Assinatura (`:256-309`, `:379-452`, `:511-536`):
- Signatários: Candidato, Empresa (responsável), "Instituição de Ensino Diretor" (de `dna_work.instituicao` via `candidato.escola`) e "Agente" (`agente_integracao`, só se a tabela tiver coluna `email`). Só vai para a ZapSign quem tem e-mail com `@`; nenhum → 422 `EMAIL_AUSENTE`.
- `external_id` na ZapSign = `rescisao-<id>`; autenticação `tokenEmail`.
- Sem rescisão gerada → 404 `RESCISAO_NAO_ENCONTRADA`. Sem `ZAPSIGN_API_TOKEN` → 503 `ZAPSIGN_NAO_CONFIGURADA`.
- Status gravado: "Assinado" se todos assinaram ou documento `signed`, senão "Aguardando". Webhook marca "Assinado"/"Recusado" pelo `zapsign_token`.
- "Documentos gerados" junta a rescisão (`origem: "rescisao"`, status "Demitido") com `contratos_gerados` do candidato/vaga (`origem: "historico"`, só leitura, clique mostra o texto).

Listagem:
- Busca `q` procura em `candidato.nome`, `empresa.razao_social`, `vaga.cargo` e CPF (se ≥3 dígitos). **Não procura em nome fantasia.**
- Regime filtra por `LIKE` na descrição da modalidade sem acento.
- Ordem padrão `id_contratacao DESC`.

## Cuidados ao mudar

- O frontend usa `status=1`/`2` fixos (filtro de Consultar e `RescisaoPage`), mas o backend usa `CONTRATACAO_STATUS_ATIVO/ENCERRADO`. Se as variáveis mudarem, as telas filtram errado.
- `DocumentosContratacao` é compartilhado entre ficha e rescisão; as chaves de cache `contratacao-documentos` e `contratacao-assinatura` são invalidadas nas duas telas.
- `ContratacaoService.list` também atende `/candidatos/:id/contratacoes`, `/empresas/:id/contratacoes` e `/vagas/:id/contratacoes` (fichas de Candidato, Empresa e Vaga) e o repo serve o dashboard (`recent`). Mudar o `SELECT`/`presentContratacao` afeta essas telas.
- O webhook `/api/v1/zapsign/webhook` é compartilhado com os termos (TCE); `TermoService.receberWebhook` roda antes e lança 400 se não houver `token`.
- Nova contratação e Rescisão chamam APIs de `empresas`, `candidatos` e `vagas`. Um usuário com acesso só a `contratacoes` recebe 403 nessas chamadas (`lib/paginas.ts`).
- `garantirRescisao` roda `CREATE TABLE/ALTER TABLE IF NOT EXISTS` a cada leitura/gravação de rescisão; precisa de permissão DDL no banco.
- O teste de concorrência depende do advisory lock e do `FOR UPDATE`; não tire.
- "Ver prévia" (antes "Gerar prévia") é só visual; nada é gravado.
- Visual no padrão das telas de Vagas/Empresas: só classes com remapeamento de tema em `index.css` (sem laranja fixo). As tabelas que rolam na horizontal têm `relative` no contêiner, para o `sr-only` do cabeçalho "Ações" não alargar a página no celular.
- O selo de assinatura (`valorAssinatura` em `documentos-contratacao.tsx`) escolhe a cor pelo texto ("Assinado", "Recusado", "Aguardando"/"Enviado"). Se o backend mudar esses textos, o selo fica cinza.

## Como testar

- Tela: abrir `/contratacoes`, filtrar; `/contratacoes/nova`, escolher empresa (≥2 letras), vaga com posição livre, candidato e registrar; abrir a ficha e clicar "Fazer a rescisão" (abre a rescisão da mesma contratação). Em `/contratacoes/rescisao/:id`, preencher motivo/data, "Gerar rescisão e demitir", responder o modal e abrir "Imprimir original" (PDF). Envio real à ZapSign só com `ZAPSIGN_API_TOKEN` configurado.
- Testes: `backend/test/escopo.test.ts` (Postgres embutido) cobre contratar até o limite, sexta bloqueada, duplicada, sem vaga, empresa divergente, concorrência na última posição e encerramento preservando histórico. Não há teste para rescisão/ZapSign (não encontrado).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm run agentes:conferir`.
