# Agente — Empresas

> Última revisão: 2026-11-12 (endereço editado vai para a triagem)

## Para que serve

Consultar as empresas clientes (cópia do Lightsail em `dna_work.empresa`), ver a ficha de cada uma (endereço, contato, condições de cobrança, vagas e contratações) e editar o cadastro. Na ficha também se cria o login da empresa no portal de empresas e se gera nova senha. O cadastro de empresa nova **não** é feito aqui: o botão "Nova empresa" e a rota `/empresas/nova` levam para `/grupos-empresas?aba=empresa` (ver agente de Grupos).

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/empresas` | `EmpresasPage` | `frontend/src/pages/EmpresasPage.tsx` | Lista paginada (20, 25, 50 ou 100 por página via `?pageSize=`) com filtros busca (CNPJ, razão social, nome fantasia ou id), cidade, UF, status (ativo/inativo) e portal (já acessou / nunca acessou / sem login). Colunas: empresa, CNPJ, cidade, portal, status. Preview ao passar o mouse. |
| `/empresas/nova` | `Navigate` | `frontend/src/App.tsx:74` | Redireciona para `/grupos-empresas?aba=empresa`. |
| `/empresas/:id` | `EmpresaDetailPage` | `frontend/src/pages/EmpresaDetailPage.tsx` | Cabeçalho, cards de cidade/contato/cadastro, cobrança (`CobrancaEmpresa`), "Portal de empresas" (`AcessoPortal`), observações, vagas (ordenadas por situação) e contratações. Botões "Nova vaga" (`/grupos-empresas?aba=vaga`) e "Editar". |
| `/empresas/:id/editar` | `EmpresaFormPage` | `frontend/src/pages/EmpresaFormPage.tsx` | Formulário de edição (razão social, fantasia, CNPJ opcional, e-mail, telefones, responsável, matriz, endereço, observações). Envia só o que mudou. |

Não há abas.

## Arquivos

Frontend
- `frontend/src/pages/EmpresasPage.tsx` — lista (funções `usoDoPortal`, `rotuloPortal`, `StatusEmpresa`).
- `frontend/src/pages/EmpresaDetailPage.tsx` — ficha + componente interno `AcessoPortal`.
- `frontend/src/pages/EmpresaFormPage.tsx` — edição (o código também sabe criar, mas nenhuma rota chega nele sem `:id`).
- `frontend/src/components/cobranca-empresa.tsx` — `CobrancaEmpresa` (também usado na aba Grupo de `/grupos-empresas`).
- `frontend/src/components/paginacao.tsx` (`Paginacao`, `tamanhoPagina`), `preview.tsx`, `pagina.tsx`, `ui.tsx`; `frontend/src/lib/format.ts`.
- Menu: `frontend/src/components/shell.tsx` (item `empresas` → `/empresas`; a página `empresas` também cobre `/grupos-empresas`).

Backend
- Rotas: `backend/src/routes/index.ts` (~191–227).
- Service: `backend/src/services/empresa.service.ts` (`EmpresaService`: CRUD + portal).
- Repository: `backend/src/repositories/empresa.repository.ts`; cobrança em `backend/src/repositories/valor-empresa.repository.ts` (`valorDaEmpresa`).
- Vagas da empresa: `backend/src/services/vaga.service.ts` (`list`) + `backend/src/repositories/vaga.repository.ts`.
- Contratações da empresa: `backend/src/services/contratacao.service.ts` (`listByEmpresa`).
- Schemas: `backend/src/schemas/empresa.ts`, `backend/src/schemas/common.ts` (`cnpjSchema`, `pageSchema`).
- Apresentação: `backend/src/services/presenters.ts` (`presentEmpresa`, `presentVaga`).
- Permissão: `backend/src/lib/paginas.ts` + hook `onRequest` em `backend/src/app.ts`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/empresas` | Lista paginada; filtros `q`, `razao_social`, `nome_fantasia`, `cnpj`, `cidade`, `uf`, `status`, `acesso` (`acessou`/`nunca`/`sem`), `sort`, `order` | `routes/index.ts:194` → `EmpresaService.list` |
| GET | `/api/v1/empresas/:id` | Ficha + `acesso_portal`, `portal` (e-mail, senha, nome) e `uso_portal` | `routes/index.ts:198` → `EmpresaService.get` |
| PATCH | `/api/v1/empresas/:id` | Edita campos permitidos | `routes/index.ts:211` → `EmpresaService.update` |
| POST | `/api/v1/empresas` | Cria empresa só em `dna_work.empresa` (não usado pela UI atual) | `routes/index.ts:191` → `EmpresaService.create` |
| GET | `/api/v1/empresas/:id/cobranca` | Condições de cobrança da empresa (ou `null`) | `routes/index.ts:201` → `valorDaEmpresa` |
| POST | `/api/v1/empresas/:id/acesso-portal` | Cria o login do portal (`{ email }`) ou gera nova senha (`{ redefinir: true }`) | `routes/index.ts:204` → `EmpresaService.gerarAcessoPortal` |
| GET | `/api/v1/empresas/:id/vagas` | Vagas da empresa (filtro `situacao` opcional); a ficha busca de 100 em 100 até 10 páginas | `routes/index.ts:214` → `VagaService.list({ id_empresa })` |
| GET | `/api/v1/empresas/:id/contratacoes` | Contratações da empresa (paginado, padrão 20) | `routes/index.ts:221` → `ContratacaoService.listByEmpresa` |

## Dados

Postgres, schema `dna_work` (cópia do Lightsail):
- `dna_work.empresa` — lido e gravado (PATCH/POST). Campos: `id_empresa`, `razao_social`, `nome_fantasia`, `cnpj`, `email` (minúsculas), `telefone`, `celular`, endereço (`cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`), `status` (1 ativo, 0 inativo), `responsavel`, `tipo_empresa`, `matriz`, `ie`, `site`, `obs`, `data_adicao`. Ao criar acesso ao portal também faz `recrutamento = 1` (ignora se a coluna não existir).
- `dna_work.usuario_empresa` — login do portal. Gravado por `gerarAcessoPortal`: `id_u`, `nome_u`, `email_u`, `senha_u` (MD5 legado), `senha_hash` (argon2), `senha_envio` (senha em texto para exibir na ficha), `telefone_u`, `empresa_u`, `status`, `tipo`, `data_senha`, `atualiza_senha`.
- `dna_work.vinculo_empresa_usuario` — vínculo usuário ↔ empresa (insert se não existir).
- `dna_work.paginas_usuario_empresa` — menus do portal (insert com valores fixos `MENU_PORTAL`, `SUB1_PORTAL`, `SUB2_PORTAL` em `empresa.service.ts:9–11`, se ainda não houver).
- `dna_work.portal_empresa_acesso` — só leitura aqui (`ultimo_login`, `ultimo_uso`, `logins`, `email`); quem grava não foi encontrado neste repositório (provavelmente o portal de empresas).
- `dna_work.vaga`, `dna_work.modalidade_vaga` — vagas da empresa (leitura).
- `dna_work.conratacaovaga` (sic), `dna_work.candidato` — contratações da empresa (leitura).

Postgres, schema `public`:
- `public.valor_empresas` — condições de cobrança (CLT/estágio, ciclo, fechamento, vencimento, notas, alertas, documentos). Só leitura; quem grava não foi encontrado no backend.

Lightsail MySQL: **não** é tocado pelas rotas desta seção. Editar aqui muda `dna_work.empresa` no Postgres e, quando algum campo de endereço vem no PATCH, também a cópia usada pela Triagem: `public.empresa` (endereço, `local`, `latitude`, `longitude`) e `public.vaga` (`cep`, `latitude`, `longitude`) da empresa, com coordenada nova pelo Google (`sincronizarEnderecoEmpresas` em `backend/src/lib/empresa-endereco.ts`).

Serviços externos: nenhum.

## Regras e comportamentos importantes

- **CNPJ opcional** (`optionalCnpj`): em branco é aceito (empresa sem CNPJ); preenchido tem que ser válido e **único** (só dígitos): create e update → 409 `CNPJ_DUPLICADO` com `details.id_empresa`. No PATCH, CNPJ em branco é ignorado (não apaga o CNPJ que já existe). O formulário aceita o campo vazio ou com 14 dígitos.
- **E-mail obrigatório no create** do backend (`empresaCreateSchema`); opcional no PATCH.
- **Matriz**: tem que ser um `id_empresa` existente (422 `MATRIZ_INVALIDA`); a empresa não pode ser matriz de si mesma. No PATCH, `matriz === id` é descartado em silêncio; no formulário, se `matriz` for o próprio id, o campo aparece vazio (`EmpresaFormPage.tsx:59`).
- **Campos editáveis**: lista `PATCHABLE` (`empresa.service.ts:27`). Sem campo → 400 `NADA_PARA_ATUALIZAR` (o formulário avisa antes, "Nenhum campo foi alterado.").
- **Ordem da lista**: ativas (`status = 1`) primeiro, depois a ordenação pedida (padrão `razao_social`).
- **Filtro `q`**: razão social ou fantasia (ILIKE), `id_empresa` exato, ou CNPJ pelos dígitos.
- **Portal** (lista): "Sem login" = sem usuário ativo; "Nunca acessou" = tem usuário ativo e nenhum `ultimo_login`; data = última entrada/uso. Filtro `acesso` usa as mesmas regras (`empresa.repository.ts:35–53`, `:133–135`).
- **Gerar acesso ao portal** (`empresa.service.ts:105`):
  - Já tem usuário ativo e não pediu `redefinir` → 409 `ACESSO_EXISTENTE`.
  - `redefinir: true` → nova senha (12 caracteres: 8 letras + 4 números, sem caracteres ambíguos) no mesmo usuário; a anterior deixa de valer. A tela pede confirmação (`window.confirm`).
  - Novo acesso: e-mail do corpo ou o da empresa; inválido → 422 `EMAIL_INVALIDO`; e-mail já usado por usuário de outra empresa → 409 `EMAIL_EM_USO`. Nome do usuário: responsável, fantasia ou razão social (o primeiro com 2+ letras). Insert/updates em transação.
  - A senha fica guardada em `senha_envio` e **volta em todo GET da ficha** (`portal.senha`) para ser copiada.
- **Efeito colateral de leitura**: `GET /empresas` e `GET /empresas/:id` executam DDL — `CREATE TABLE IF NOT EXISTS dna_work.portal_empresa_acesso` e `ALTER TABLE dna_work.usuario_empresa ADD COLUMN IF NOT EXISTS senha_envio` (`empresa.service.ts:259–275`). Se `usuario_empresa` não existir (42P01), a ficha mostra "sem acesso" em vez de falhar.
- **Vagas na ficha**: ordenadas aberta → pausada → contratada → fechada, depois pela data de abertura mais recente (`EmpresaDetailPage.tsx:20–29`). `situacao` vem de `presentVaga`/`statusDaVaga`.
- **Cobrança**: o card só aparece se existir linha em `public.valor_empresas` para o `id_empresa`.
- **Permissão**: `/api/v1/empresas*` exige a página `empresas` ou admin (`lib/paginas.ts:33`).

## Cuidados ao mudar

- Esta tela e a aba Empresa de `/grupos-empresas` gravam em lugares **diferentes**: aqui só `dna_work.empresa`; lá Lightsail + `public.empresa` + `dna_work.empresa`. Editar aqui não atualiza o Lightsail. Em `public.empresa` só o endereço e a coordenada acompanham a ficha (nome, CNPJ e contato não). Se o Google falhar, a edição é salva mesmo assim e a triagem corrige na próxima busca ou no próximo sync.
- `GET /api/v1/empresas?q=` também é usado pelo formulário de candidato (busca de empresa) — não mude o formato de resposta.
- `CobrancaEmpresa` é compartilhado com a aba Grupo.
- O hash MD5 em `senha_u` existe por compatibilidade com o portal legado; não remova sem saber como o portal autentica.
- `senha_envio` guarda senha em texto e é exposta no GET da ficha: qualquer mudança aqui tem impacto de segurança.
- O PATCH monta o `SET` com as chaves recebidas; é seguro só por causa do filtro `PATCHABLE`.
- A ficha busca até 1.000 vagas (10 × 100); empresas com mais que isso ficam cortadas.
- Não confundir `id_empresa` (`dna_work.empresa`, string) com `id` (`public.empresa`, uuid); as empresas criadas em `/grupos-empresas` usam o mesmo valor nos dois.

## Como testar

- Manual: `/empresas` → testar busca por CNPJ com e sem máscara, filtros de status e portal, troca de "por página" (20/25/50/100); abrir uma ficha; editar e salvar só um campo; "Gerar acesso" (com e-mail) e "Gerar nova senha" — só em base de teste, pois grava login real do portal.
- Testes backend em `backend/test/escopo.test.ts` (Postgres embutido): "cadastra empresa e bloqueia CNPJ duplicado", "pesquisa candidatos e empresas com filtro e paginação", "gera acesso ao portal e mostra e-mail e senha na empresa".
- Frontend: sem teste específico.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
