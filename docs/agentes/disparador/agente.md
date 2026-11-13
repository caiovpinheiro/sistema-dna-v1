# Agente — Disparador

> Última revisão: 2026-11-13 (commit "Disparador pelo CRM: conferir telefones, criar deals e disparar template.")

## Para que serve

Grupo "Disparador" do menu, com duas opções:

- **Pelo CRM** (`/disparador/crm`): tela para colar telefones ou importar uma planilha, conferir no CRM Bwipo quem já existe (contato e negócios abertos), criar ou mover os negócios para um funil e fase escolhidos (com os campos personalizados vindos das colunas da planilha) e, se quiser, disparar um template de WhatsApp para os selecionados.
- **Infojobs**: link externo para o disparador Infojobs (abre em nova aba). Não é página deste sistema.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/disparador/crm` | `DisparadorCrmPage` | `frontend/src/pages/DisparadorCrmPage.tsx` | Cabeçalho padrão com o botão "Abrir disparador Infojobs". Bloco 1 "Telefones" com as abas Colar / Importar planilha; bloco 2 "Quem já está no CRM" (filtros Todos / No CRM / Novos / Inválidos, tabela com seleção, negócios abertos e a coluna Ação com o resultado); lateral "Criar e ativar" (funil, fase, "mover quem já tem negócio aberto") e "Disparar template de WhatsApp". |
| (menu) Infojobs | link `<a target="_blank">` | `frontend/src/components/shell.tsx` | `DISPARADOR_URL` |

Importar planilha: aceita `.xlsx` e `.csv` (o `.xls` antigo é recusado com orientação). Depois do envio aparece uma tabela com cada coluna, um exemplo e um seletor: Ignorar, Telefone, Nome do contato ou um campo personalizado de negócio do CRM. A tela sugere o uso pelo nome da coluna (telefone/celular/whats, nome, nome ou rótulo do campo).

## Arquivos

Frontend
- `frontend/src/pages/DisparadorCrmPage.tsx` — toda a tela (exporta também `DISPARADOR_INFOJOBS_URL`).
- `frontend/src/components/shell.tsx` — `disparadorLinks` (grupo "Disparador": "Pelo CRM" e "Infojobs", este com `externo: true`), `CAMINHOS` (`/disparador/crm` → `disparador-crm`) e título da rota.
- `frontend/src/App.tsx` — rota `/disparador/crm`.

Backend
- `backend/src/routes/index.ts` — rotas `/api/v1/disparo-crm/*`.
- `backend/src/services/disparador.service.ts` — `DisparadorService` (`configuracao`, `verificar`, `criar`, `disparar`) e `separarTelefones`.
- `backend/src/lib/planilha.ts` — leitura de `.xlsx` (via jszip, sem biblioteca nova) e `.csv` (`;` ou `,`).
- `backend/src/origem/crm-dna.ts` — `crmRequest` (cliente HTTP do CRM) e `backend/src/origem/phone.ts` — `normalizePhone`.
- `backend/src/lib/paginas.ts` — página `disparador-crm` e regra `/api/v1/disparo-crm`.
- `backend/test/disparador.test.ts`, `backend/test/paginas.test.ts`.

## API usada

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/v1/disparo-crm/config` | Funis com fases (CRM `GET /api/pipelines`), campos personalizados de negócio (`GET /api/custom-fields?entity=deal`) e se há canal/templates configurados. |
| POST | `/api/v1/disparo-crm/verificar` | `{ telefones: string }` (texto colado). Para cada telefone: normalizado, válido, contato (`GET /api/contacts?phone=`) e negócios abertos (`GET /api/deals?contactPhone=&status=OPEN`). Até 300 por vez. |
| POST | `/api/v1/disparo-crm/planilha` | `{ arquivo: { nome, base64 } }` → `{ colunas, linhas }`. Limite 8 MB e 5000 linhas. Não grava nada. |
| POST | `/api/v1/disparo-crm/criar` | `{ stageId, moverExistentes, itens: [{ telefone, nome?, campos? }] }` (até 300). Quem já tem negócio aberto no mesmo funil: fica ("ja_estava") ou vai para a fase (`PUT /api/deals/:id` + `PUT /api/deals/:id/custom-fields`, "movido"). Quem não tem: `POST /api/leads` (contato + negócio de uma vez, "criado"). Erro de um item não para os outros. |
| POST | `/api/v1/disparo-crm/disparar` | `{ contatoIds, template, idioma, nome }`. Cria a etiqueta `disparo-sistema-<data-hora>`, coloca nos contatos, cria a campanha (`POST /api/integrations/campaigns`, tipo TEMPLATE, filtro pela etiqueta) e lança (`/launch`). |

## Dados

Nada é gravado no banco do sistema; tudo vai para o CRM Bwipo. Variáveis de ambiente (só os nomes):
- `CRM_DNA_API_URL`/`CRM_DNA_API_TOKEN` ou `CRM_BASE_URL`/`CRM_API_KEY` — acesso ao CRM (as mesmas já usadas pelo sistema).
- `BWIPO_CANAL_DISPARO_ID` — canal de WhatsApp das campanhas. Sem ele, a campanha usa o último canal de conversa de cada contato.
- `BWIPO_TEMPLATES_DISPARO` — nomes de templates separados por vírgula, só para sugerir no campo (a API do CRM não lista templates com token).

## Regras e comportamentos importantes

- Permissão: página `disparador-crm` ("Disparador pelo CRM", grupo Geral). Não é dada automaticamente; o administrador marca em Configurações. O item "Infojobs" continua na página `disparador`.
- Telefones são normalizados para 55 + DDD + número; duplicados (mesmo número normalizado) viram um só; inválidos aparecem no filtro "Inválidos" e não podem ser selecionados.
- O contato novo entra com `lifecycleStage: LEAD`, origem `DNA Work - disparador (<e-mail do usuário>)` e título do negócio "Negócio <nome>". O `POST /api/leads` é idempotente por telefone no CRM.
- A fase escolhida não pode ser de ganho ou perda (a lista esconde essas).
- O disparo só usa contatos que existem no CRM (já existentes ou criados na mesma tela). O nome do template aceita só `a-z`, `0-9` e `_`.

## Cuidados ao mudar

- Os endpoints `/api/channels`, `/api/meta/whatsapp/message-templates` e `/api/deals/:id/move` do Bwipo só funcionam com sessão, não com o token. Por isso canal e template vêm do ambiente/digitação e a troca de fase usa `PUT /api/deals/:id`.
- A campanha por integração exige filtro restritivo; a etiqueta por disparo é o filtro. Não troque por "todos os contatos".
- O prefixo da API é `/api/v1/disparo-crm` (não `/api/v1/disparador`): o teste de páginas garante que `/api/v1/disparador` não pertence a nenhuma página.
- O usuário dono do token precisa ter permissão no CRM para criar etiquetas e campanhas.

## Como testar

- `cd backend && npm test` (arquivo `test/disparador.test.ts`: telefones colados, CSV e xlsx, verificar, criar, disparar com e sem canal).
- Na tela, com um usuário com a página liberada: colar dois telefones (um existente, um novo), "Conferir no CRM", conferir os selos; importar um `.xlsx` com colunas Telefone/Nome/um campo, conferir as sugestões do mapeamento.
- Criar e disparar gravam no CRM de produção: teste com um número seu e um funil de teste.
