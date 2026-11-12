# Agente — Configurações

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Tela só do administrador para gerenciar quem entra no sistema interno. Lista os usuários com contagem (total, com acesso, sem acesso), permite criar usuário (nome, e-mail, senha e páginas), bloquear/liberar o login, trocar a senha, marcar as páginas que cada pessoa pode usar (por área ou uma a uma) e apagar o usuário.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/configuracoes` | `ConfiguracoesPage` | `frontend/src/pages/ConfiguracoesPage.tsx` | Contagem, lista de usuários à esquerda e o painel da direita |
| `/configuracoes` (painel "Novo usuário") | `NovoUsuario` | mesmo arquivo | Formulário Nome/E-mail/Senha + páginas |
| `/configuracoes` (painel do usuário escolhido) | `Editor` | mesmo arquivo | Nova senha, "Pode entrar no sistema", páginas, Salvar, Apagar usuário (com confirmação) |

Componentes internos: `PaginasMarcadas` (caixas agrupadas por área) e `CaixaArea` (caixa da área com estado "meio marcado").

## Arquivos

Frontend
- `frontend/src/pages/ConfiguracoesPage.tsx` — tudo da tela.
- `frontend/src/components/shell.tsx` — link "Configurações" só aparece para admin; a rota mostra "Somente o administrador configura os acessos." para os demais (`shell.tsx:283`).
- `frontend/src/components/ui.tsx`, `frontend/src/lib/api.ts`.

Backend
- `backend/src/routes/index.ts` — rotas `/api/v1/configuracoes/*` (~linhas 591-620).
- `backend/src/services/acesso.service.ts` — `listar`, `criar`, `salvar`, `apagar`, `daSessao`.
- `backend/src/lib/paginas.ts` — `PAGINAS` (id, nome, grupo) e `IDS_PAGINA`.
- `backend/src/app.ts` — hook que exige admin para qualquer `/api/v1/configuracoes*`.
- `backend/src/services/sync-ciclo.service.ts` — usado só pela rota `POST /configuracoes/sync` (não chamada por esta tela).
- `prisma/migrations/20261021193000_app_usuario/migration.sql`, `prisma/migrations/20261025040000_acesso_paginas/migration.sql`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/configuracoes/acessos` | Usuários com páginas, contagens e catálogo `PAGINAS` | `AcessoService.listar` |
| POST | `/api/v1/configuracoes/usuarios` | Cria usuário ativo com senha e páginas; devolve o painel + `criado` (id) | `AcessoService.criar` |
| PATCH | `/api/v1/configuracoes/usuarios/:id` | Salva `ativo`, `paginas` e `senha` opcional | `AcessoService.salvar` |
| DELETE | `/api/v1/configuracoes/usuarios/:id` | Apaga o usuário e as páginas | `AcessoService.apagar` |
| POST | `/api/v1/configuracoes/sync?dry=1` | Dispara o sync de vagas abertas, cargos e Notion manualmente | `SyncCicloService.executar` — **não é usado por esta tela** (não encontrei chamada no frontend) |

Todas as respostas de escrita devolvem o painel inteiro (mesmo formato do GET).

## Dados

Postgres, schema `dna_work`:
- `dna_work.app_usuario` — `id` (uuid gerado com `randomUUID`), `nome`, `email` (único, gravado em minúsculas), `senha_hash` (argon2, `@node-rs/argon2`), `ativo`, `admin`, `criado_em`. Lido e gravado.
- `dna_work.app_usuario_pagina` — (`id_usuario`, `pagina`), chave primária composta, FK para `app_usuario`. Lido e gravado (apaga tudo e reinsere ao salvar).

Variável usada: `ADMIN_EMAIL` (o administrador do ambiente). Nenhum serviço externo nesta tela.

## Regras e comportamentos importantes

- Acesso: o hook em `app.ts` recusa qualquer `/api/v1/configuracoes*` para quem não é admin (403 `ACESSO_NEGADO`). Admin = `app_usuario.admin = true`, ou e-mail igual a `ADMIN_EMAIL`, ou sessão `bootstrap-admin`.
- `listar` ordena por admin, depois ativos, depois nome; marca como admin quem tem e-mail igual a `ADMIN_EMAIL`.
- Criar (`acesso.service.ts:58-84`): nome 2–120, e-mail válido até 180, senha 8–80 (com `trim`) — validação zod na rota. O frontend exige pelo menos uma página marcada ("Marque pelo menos uma página."), o backend aceita lista vazia. E-mail igual ao `ADMIN_EMAIL` ou já existente (sem diferenciar maiúsculas) → 409 `EMAIL_EM_USO`. Ids de página desconhecidos são descartados em silêncio. Insere usuário e páginas numa transação; sempre cria com `ativo = true`, `admin = false`.
- Salvar (`acesso.service.ts:117-148`): senha opcional; se vier, mínimo 8 (422 `SENHA_CURTA`). Para admin só troca a senha; sem senha → 409 `ADMIN_PROTEGIDO` "O administrador mantém acesso a todas as páginas." Para os demais, atualiza `ativo`, mantém a senha se não vier nova, apaga e regrava todas as páginas (transação).
- Desmarcar "Pode entrar no sistema" bloqueia o login (`findStaff` exige `ativo`) e as requisições já abertas (403 `SEM_ACESSO`); as páginas ficam guardadas.
- Apagar (`acesso.service.ts:87-115`): 404 se não existe; admin → 409 `ADMIN_PROTEGIDO`; o próprio usuário logado → 409 `PROPRIO_USUARIO`. Apaga páginas e usuário numa transação. É definitivo. O frontend esconde o botão para admin e pede confirmação ("isso não pode ser desfeito").
- A mudança de páginas vale na próxima requisição da pessoa, porque a permissão é lida do banco a cada chamada (`daSessao`); o menu dela só muda quando o frontend recarregar `/auth/me`.
- Mensagens de sucesso: "Usuário criado.", "Acesso salvo.", "Usuário apagado."; após criar, o novo usuário fica selecionado.

## Cuidados ao mudar

- O catálogo de páginas vem do backend (`PAGINAS` em `lib/paginas.ts`); os grupos da tela são o campo `grupo`. Página nova precisa estar também em `REGRAS_API` (backend) e `CAMINHOS` do `shell.tsx` (frontend), senão marcar a caixa não protege nada.
- Renomear um id em `PAGINAS` não migra `app_usuario_pagina`: as linhas antigas viram lixo e as pessoas perdem o acesso.
- No `Editor` de um admin o botão Salvar sem nova senha recebe 409 do backend; é esperado.
- A validação de senha existe no frontend e no backend (zod + service); mantenha as duas iguais.
- `POST /configuracoes/sync` mora sob o mesmo prefixo só para herdar a regra "só admin"; não mova sem recriar a proteção.
- A migration de criação semeia usuários reais; não copie dados dela para documentação ou testes.

## Como testar

- Entrar como admin, abrir `/configuracoes`: criar usuário de teste com algumas páginas, entrar com ele em outra janela e conferir o menu; desmarcar "Pode entrar no sistema" e ver o 403/bloqueio; trocar a senha; apagar.
- Entrar como não admin e abrir `/configuracoes`: deve aparecer "Somente o administrador configura os acessos."
- Testes: não encontrei teste específico do `AcessoService` nem das rotas `/configuracoes`. `backend/test/triagem-rotas.test.ts` simula `app_usuario`/`app_usuario_pagina` para checar a permissão de página.
- Comandos: `npm test -w backend`, `npm run lint -w backend`, `npm run lint -w frontend`.
