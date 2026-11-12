# Agente — Login

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Tela de entrada do sistema interno. A pessoa informa e-mail e senha; o backend confere em `dna_work.app_usuario` (ou no administrador definido no ambiente) e grava um cookie de sessão httpOnly com um JWT. Depois disso o `Shell` lê `/api/v1/auth/me` para saber se a pessoa é administradora e quais páginas pode ver, monta o menu e bloqueia as rotas sem permissão. O botão "Sair" do menu encerra a sessão.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/login` | `LoginPage` | `frontend/src/pages/LoginPage.tsx` | Formulário E-mail/Senha; depois do sucesso, vídeo `/login-sucesso.webm` com "Login realizado" e o nome |
| todas as outras | `Protected` + `Shell` | `frontend/src/App.tsx`, `frontend/src/components/shell.tsx` | Carrega a sessão, menu lateral filtrado por permissão, botão Sair, troca de tema |

## Arquivos

Frontend
- `frontend/src/pages/LoginPage.tsx` — formulário e tela de sucesso.
- `frontend/src/App.tsx` — `Protected` (consulta `["me"]`, redireciona para `/login` em erro) e o `Toast`.
- `frontend/src/components/shell.tsx` — menu, `paginaDoCaminho` (rota → id de página), `permitido`, `logout`, bloqueio de `/configuracoes` para não admin.
- `frontend/src/lib/api.ts` — `api()` com `credentials: "include"` e `ApiError`.
- `frontend/src/components/fundo-liquido.tsx`, `frontend/src/components/ui.tsx`.

Backend
- `backend/src/plugins/auth.ts` — registra `@fastify/cookie` e `@fastify/jwt` (cookie `dnawork_session`), `authenticate`, `verifyAdminPassword`, `sessionCookie`.
- `backend/src/routes/index.ts` — `POST /api/v1/auth/login` (~linha 87), `GET /api/v1/auth/me` (~106), `POST /api/v1/auth/logout` (~116), `findStaff` (~905).
- `backend/src/app.ts` — hook `onRequest` (~linha 151): rotas públicas, autenticação, checagem de página.
- `backend/src/services/acesso.service.ts` — `daSessao` (admin? ativo? páginas).
- `backend/src/lib/paginas.ts` — `PAGINAS` (ids) e `REGRAS_API`/`paginasDaApi` (prefixo da API → páginas exigidas).
- `backend/src/config.ts` — variáveis de sessão.
- `prisma/migrations/20261021193000_app_usuario`, `prisma/migrations/20261025040000_acesso_paginas` — criação das tabelas.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Confere e-mail/senha, grava o cookie `dnawork_session`, devolve `email`, `role`, `nome` | `routes/index.ts` |
| GET | `/api/v1/auth/me` | Devolve `email`, `role`, `admin`, `paginas` da sessão | `routes/index.ts` → `AcessoService.daSessao` |
| POST | `/api/v1/auth/logout` | Apaga o cookie | `routes/index.ts` |

## Dados

Postgres, schema `dna_work`:
- `dna_work.app_usuario` — `id` (uuid), `nome`, `email` (único), `senha_hash` (argon2), `ativo`, `admin`. Lido no login (`findStaff`, por `lower(email)`) e em cada requisição (`daSessao`).
- `dna_work.app_usuario_pagina` — `id_usuario`, `pagina` (ids de `lib/paginas.ts`). Lido em cada requisição.

Variáveis de ambiente (só nomes): `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` ou `ADMIN_PASSWORD` (uma das duas é obrigatória), `SESSAO_HORAS` (padrão 8, máx. 2160), `COOKIE_SECURE`, `CORS_ORIGIN`. Nenhum serviço externo.

## Regras e comportamentos importantes

- Login (`routes/index.ts` ~87-104): e-mail é `trim().toLowerCase()`. Se existe usuário em `app_usuario` com esse e-mail, só vale a senha dele e só se `ativo = true`. O administrador do ambiente (`ADMIN_EMAIL` + senha do ambiente) só entra se **não** existir linha em `app_usuario` com esse e-mail; aí o JWT recebe `sub = "bootstrap-admin"`.
- Erro de credencial: 401 `CREDENCIAIS_INVALIDAS` "E-mail ou senha inválidos." Limite de 10 tentativas por minuto nessa rota (429 `MUITAS_REQUISICOES`); limite global de 300/min.
- Todo JWT sai com `role: "admin"`; `authenticate` recusa outro role (403). A permissão real **não** está no token: `daSessao` consulta o banco a cada requisição, então desativar ou trocar páginas vale na hora, sem novo login.
- `daSessao` (`acesso.service.ts:20-33`): `sub = "bootstrap-admin"` ou e-mail igual a `ADMIN_EMAIL` → admin com todas as páginas; usuário inexistente ou inativo → sem páginas; `admin = true` → todas; senão as páginas de `app_usuario_pagina`.
- Cookie: `dnawork_session`, httpOnly, `sameSite=lax`, `path=/`, `secure` conforme `COOKIE_SECURE`, validade `SESSAO_HORAS` horas (igual à do JWT) (`plugins/auth.ts:55-63`).
- Hook `onRequest` (`app.ts` ~151-167): rotas públicas = `/health`, `/api/v1/auth/login`, webhooks (`zapsign`, `asaas`, `lead-criado`, `ganho`), `/api/v1/servico/*` listados e `/docs`. Todo o resto em `/api/` exige cookie válido (401 `NAO_AUTENTICADO`). Em `/api/v1/auth/*` não há checagem de página. `/api/v1/configuracoes*` exige admin (403 `ACESSO_NEGADO`). Usuário inativo recebe 403 `SEM_ACESSO`. Rota cujo prefixo está em `REGRAS_API` exige ao menos uma das páginas listadas (403 `PAGINA_NEGADA`); prefixo fora da lista não exige página.
- Frontend: `Protected` chama `/auth/me` com `retry: false`; erro → `<Navigate to="/login">`. Após login com sucesso, invalida `["me"]`, mostra o vídeo e vai para `/` quando o vídeo termina ou após 8 s (`LoginPage.tsx:24-28`).
- Menu (`shell.tsx`): item aparece se `admin || paginas.includes(id)`. "Configurações" só para admin. Se a pessoa não tem `painel`, o grupo Triagem sobe para o topo. Rota protegida sem permissão mostra "Você não tem acesso a esta página." no lugar da página.
- Logout (`shell.tsx:178-182`): chama a API, mostra toast "Sessão encerrada." e faz `window.location.href = "/login"`.
- O tema (claro/escuro) fica em `localStorage["dnawork-tema"]` e dispara o evento `dnawork-tema` (usado também pela página de E-mails).

## Cuidados ao mudar

- Página nova precisa ser registrada em três lugares para a permissão funcionar: `PAGINAS` e `REGRAS_API` em `backend/src/lib/paginas.ts`, e `CAMINHOS`/links em `frontend/src/components/shell.tsx`. Rota que não está em `CAMINHOS` não é bloqueada no frontend (o backend ainda bloqueia pela API se estiver em `REGRAS_API`).
- A ordem de `CAMINHOS` e `REGRAS_API` importa: o primeiro prefixo que casar vence (ex.: `/api/v1/asaas/regua` antes de `/api/v1/asaas`).
- Rota pública nova (webhook) precisa entrar na lista do hook em `app.ts`, senão recebe 401.
- `logout()` faz `await api(...)` sem `try`: se a sessão já expirou, a API devolve 401, `api()` lança erro e o redirecionamento para `/login` não acontece (o usuário só vê o erro). Mudar com cuidado.
- `/auth/logout` não está na lista pública, então exige cookie válido.
- Se alguém criar em `app_usuario` uma linha com o mesmo e-mail de `ADMIN_EMAIL`, a senha do ambiente deixa de funcionar para esse e-mail.
- O log do Fastify redige `cookie`, `authorization` e `req.body.password`; não registre o corpo do login em outro lugar.
- Os testes sobem o app com `ADMIN_EMAIL`/`ADMIN_PASSWORD` próprios de teste; mudar a lógica de bootstrap quebra `escopo.test.ts`.

## Como testar

- Abrir `/login`, entrar com um usuário de teste, conferir o vídeo e o redirecionamento; testar senha errada (mensagem em vermelho) e usuário desativado em Configurações (não entra).
- Com um usuário sem a página `painel`, conferir que o menu começa por Triagem e que `/` mostra "Você não tem acesso".
- Testes: `backend/test/escopo.test.ts` (login do admin, 401 sem cookie, 401 com senha errada, `/auth/me`), `backend/test/triagem-rotas.test.ts` (rotas exigem login e a página `triagem`).
- Comandos: `npm test -w backend`, `npm run lint -w backend`, `npm run lint -w frontend`. Para gerar hash de senha do admin: `npm run hash-password`.
