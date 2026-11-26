# Agente — Autorização MCP

> Última revisão: 2026-11-26 (commit df7000a)

## Para que serve

Tela em que o colaborador autoriza ou recusa a conexão de um assistente (ex.: ChatGPT) ao DNA Work pelo MCP. É o passo de consentimento do fluxo OAuth: o servidor OAuth (oidc-provider, no monólito) manda o navegador para cá com o `uid` do pedido.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/mcp/autorizar/:uid` | `McpAutorizarPage` | `frontend/src/pages/McpAutorizarPage.tsx` | Aplicativo que pede acesso, usuário logado, integração (nome, finalidade, descrição), escopos, módulos que ele realmente poderá consultar, abrangência, contato, privacidade e os botões Autorizar e Recusar. Fica fora do menu (sem `Shell`). |

Sem sessão, vai para `/login?next=/mcp/autorizar/:uid` e volta depois do login.

## Arquivos

- `frontend/src/pages/McpAutorizarPage.tsx`, `frontend/src/App.tsx` (rota) e `frontend/src/pages/LoginPage.tsx` (`next`).
- Backend: `backend/src/mcp/consentimento.ts`.

## API usada

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/api/v1/mcp/interacao/:uid` | Dados do pedido: `pode`, `motivo`, aplicativo, integração, escopos, `modulos` e `abrangencia` efetivos, `contato`, `privacidade` |
| POST | `/api/v1/mcp/interacao/:uid/decisao` | Corpo `{ aprovar }`; exige `Origin` do painel (CSRF); devolve `redirectTo` para retomar o fluxo OAuth |

## Dados

Lê `dna_work.mcp_integracao`, `mcp_integracao_usuario` e o estado de interação do OAuth (`mcp_oauth_registro`). Grava só o resultado da interação e o grant.

## Regras e comportamentos importantes

- Só usuário real, ativo e vinculado pelo administrador à integração pode autorizar (o bootstrap-admin nunca).
- O consentimento não amplia nada: módulos e abrangência mostrados vêm da mesma política recalculada a cada chamada.
- Escopos desconhecidos são ignorados e mostrados; nunca viram `mcp:read`.
- Não mostra token, segredo nem dado de candidato.

## Cuidados ao mudar

Manter a checagem de `Origin`; não exibir credenciais; os textos de privacidade vêm do backend.

## Como testar

`npx tsx --test backend/test/mcp-admin.test.ts` (teste "consentimento OAuth") e abrir o fluxo `/oauth/authorize` de um cliente de teste.
