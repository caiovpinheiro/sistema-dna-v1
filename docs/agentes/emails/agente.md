# Agente — E-mails

> Última revisão: 2026-11-13 (commit "Repagina as telas restantes no padrão novo")

## Para que serve

Editor dos modelos de e-mail que o sistema envia automaticamente (assinatura digital do TCE, cobrança Asaas, relatório da régua de cobrança etc.). A pessoa escolhe um modelo na lista, ajusta nome, assunto e mensagem, insere campos variáveis (nome do candidato, empresa, links...) e vê uma prévia com valores de exemplo. Pode salvar ou excluir o modelo. Esta tela **não envia** e-mail.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/emails` | `EmailsPage` | `frontend/src/pages/EmailsPage.tsx` | Cabeçalho padrão (`CabecalhoPagina`). Lista de modelos à esquerda (com a contagem; o escolhido fica em ciano), bloco "Editar modelo" (Nome do modelo, Assunto, Mensagem, Campos da mensagem com "Colocar na mensagem" e, para cada campo usado, o exemplo e "Colocar de novo na mensagem"; no fim "Excluir modelo" e "Salvar alterações") e, à direita, a prévia "Como o e-mail sai" (De/Para/Assunto + iframe). Carregando com `Skeleton`, erro com `Alerta` e lista vazia com `Empty`. |

Sem abas nem subrotas. Exige a página `emails`.

## Arquivos

Frontend
- `frontend/src/pages/EmailsPage.tsx` — tudo: lista `CAMPOS` (token do sistema ↔ nome amigável ↔ exemplo), conversões `paraOperacao`/`paraSistema`, `htmlParaTexto`/`textoParaHtml`, prévia.
- `frontend/src/components/ui.tsx`, `frontend/src/lib/api.ts`.

Backend
- `backend/src/routes/index.ts` — rotas `/api/v1/emails` (~linhas 459-474).
- `backend/src/lib/email-modelo.ts` — `listarModelosEmail`, `salvarModeloEmail`, `excluirModeloEmail`; e também `enviarModelo`/`aplicarVariaveis`/`textoHtml`, usados no envio real.
- `backend/src/lib/mailjet.ts` — envio pelo Mailjet (não usado por esta tela).
- Quem envia com esses modelos: `backend/src/services/tce.service.ts` (`enviarAssinaturas`, `enviarAssinaturaEscola`), `backend/src/services/asaas.service.ts` (~linha 241), `backend/src/services/regua.service.ts` (~linha 492).

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/emails` | Lista modelos: `id` (id_email), `vinculo`, `descricao`, `assunto`, `texto`, `remetente` | `listarModelosEmail` |
| PATCH | `/api/v1/emails/:id` (id = `id_email`) | Salva nome (`descricao`, no vínculo), `assunto` e `texto` (no e-mail) | `salvarModeloEmail` |
| DELETE | `/api/v1/emails/vinculos/:id` (id = vínculo) | Apaga o vínculo e, se nenhum outro vínculo usar, o e-mail | `excluirModeloEmail` |

## Dados

Postgres, schema `dna_work` (tabelas do legado):
- `dna_work.emailsvinculo` — `id` (vínculo), `descricao` (nome do modelo, **é a chave usada no envio**), `id_email`, `conta_email`. Lido, `descricao` gravado, linha apagada no excluir.
- `dna_work.emails` — `id_email`, `assunto`, `texto` (HTML). Lido e gravado; apagado se ficar sem vínculo.
- `dna_work.servidor_email` — `id`, `remetente_jetmail` (remetente mostrado na prévia). Só leitura, ligado por `servidor_email.id::text = emailsvinculo.conta_email::text`.

Serviço externo (no envio, fora desta tela): **Mailjet**, variáveis `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_FROM`, `MAILJET_FROM_NAME`.

## Regras e comportamentos importantes

- Listagem: só vínculos com `id_email` diferente de nulo/0 e `texto` não vazio, ordenados por `descricao` (`email-modelo.ts:71-88`).
- Variáveis: no banco o texto usa tokens como `@Nome-Candidato`; ao abrir, a tela troca por `{{Nome do candidato}}` (`paraOperacao`) e tira as tags HTML (`htmlParaTexto`); ao salvar, faz o caminho inverso (`textoParaHtml` em parágrafos/`<br>` e `paraSistema`). As trocas são feitas do token mais longo para o mais curto, para `@Hora` não engolir `@Hora-Entrevista`.
- `{{...}}` que não estão em `CAMPOS` são salvos como estão (não viram token) e aparecem na lista de campos com o nome cru.
- Validação: rota exige `assunto` 1–300, `texto` 1–100.000, `descricao` 1–120, `vinculo` inteiro positivo; o botão Salvar fica desabilitado com nome, assunto ou mensagem vazios.
- Nome repetido em outro vínculo → 409 `MODELO_REPETIDO` "Já existe um modelo com esse nome."; vínculo ou e-mail inexistente → 404 `MODELO_NAO_ENCONTRADO`.
- Excluir pede `window.confirm` e é definitivo (DELETE real no banco).
- Prévia: iframe com `sandbox=""` (sem scripts), cores seguem o tema (`localStorage["dnawork-tema"]`, evento `dnawork-tema`). "De" mostra `remetente` ou `documentos@dnawork.ai`; "Para" é um endereço fictício fixo. Os valores de exemplo editados ficam só na tela.
- No envio (`enviarModelo`), o modelo é buscado por `emailsvinculo.descricao` exato; os tokens são trocados pelos valores passados pelo serviço; o remetente é `remetente_jetmail` ou `MAILJET_FROM`; destinatários repetidos são ignorados.

## Cuidados ao mudar

- **Renomear um modelo quebra envios.** O código procura pelo nome exato: "Assinatura Digital Candidato", "Assinatura Digital Responsável Candidato", "Assinatura Digital Empresa", "Assinatura Digital Instituição de Ensino", "Assinatura manual instituição" (TCE), "Geração de cobrança Asaas" (Asaas) e "Relatorio cobrança" (régua). Renomeado ou excluído → 404 `MODELO_NAO_ENCONTRADO` na hora de enviar. A tela não avisa isso.
- **Salvar achata o HTML.** Ao abrir, as tags são removidas e, ao salvar, o texto vira só `<p>`/`<br>`. Tabelas, links com texto, negrito e estilos do HTML original se perdem no primeiro salvamento.
- Vários vínculos podem apontar para o mesmo `id_email`; salvar o texto de um muda todos (o `excluir` já considera isso).
- A lista `CAMPOS` do frontend precisa ter os mesmos tokens que os serviços passam em `aplicarVariaveis` (ex.: `@Link-Assinatura-Digital`, `@Valor`, `@Vencimento`, `@link-pg`, `@tabela-cobranca`, `@CNPJ-Empresa`). Token novo no backend sem entrada em `CAMPOS` aparece para o usuário como texto cru.
- Tokens em `@...` são trocados por simples `split/join`; um token que é prefixo de outro depende da ordenação por tamanho, nos dois lados.
- A permissão vem do prefixo `/api/v1/emails` → página `emails` (`lib/paginas.ts`).

## Como testar

- Abrir `/emails`, escolher um modelo, inserir um campo com "Colocar na mensagem", trocar o exemplo e ver a prévia; trocar o tema no topo e ver a prévia mudar. "Salvar alterações" fica desligado com nome, assunto ou mensagem vazios.
- Salvar num ambiente de teste e conferir no banco que o texto voltou com tokens `@...`; tentar salvar com um nome que já existe (409).
- Testes: não encontrei teste automatizado para `email-modelo.ts` nem para `EmailsPage`.
- Comandos: `npm test -w backend`, `npm run lint -w backend`, `npm run lint -w frontend`.
