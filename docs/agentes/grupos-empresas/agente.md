# Agente — Grupos (Grupos, Empresas e Vagas)

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Tela de cadastro em cascata: primeiro o grupo, depois a empresa do grupo, depois a vaga da empresa. É aqui que se cria empresa nova (gravando no Lightsail e no Postgres, com geocodificação) e que se abrem vagas (uma ou várias posições de uma vez, opcionalmente a partir de um modelo global). O mesmo formulário de vaga, sem empresa e sem quantidade, é usado para criar/editar modelos globais (`ModeloFormPage`).

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/grupos-empresas` ou `?aba=grupo` | `GruposEmpresasPage` → `AbaGrupo` | `frontend/src/pages/GruposEmpresasPage.tsx` | Formulário "Novo grupo" + lista pesquisável de grupos (filtro no navegador). |
| `/grupos-empresas?aba=grupo&grupo=<uuid>` | `AbaGrupo` (selecionado) | idem | Detalhe do grupo: empresas associadas (clique abre `/empresas/:id`) e "Cobrança das empresas" (`CobrancaEmpresa` por empresa). |
| `/grupos-empresas?aba=empresa[&grupo=<uuid>]` | `AbaEmpresa` | idem | Formulário de empresa nova (grupo, CNPJ, razão social, fantasia, CEP com ViaCEP, endereço, contato). |
| `/grupos-empresas?aba=vaga[&empresa=<uuid>][&modelo=<vaga_id>]` | `AbaVaga` (modo `vaga`) | idem | Formulário de abertura de vaga: empresa, modelo (opcional), tipo, carga, cargo (lista ou "+ Novo cargo"), salário, horários, dias (fixo/escala/folga), sexo, idade, quantidade, atividades, benefícios. |
| `/vagas/modelos/novo` | `ModeloFormPage` → `AbaVaga` (modo `modelo`) | idem | Criar modelo global (sem empresa e quantidade). Salvar volta para `/vagas/modelos`. |
| `/vagas/modelos/:id/editar` | `ModeloFormPage` → `AbaVaga` (modo `modelo`) | idem | Editar modelo global. |
| `/empresas/nova`, `/vagas/nova` | `Navigate` | `frontend/src/App.tsx:74`, `:81` | Redirecionam para `?aba=empresa` e `?aba=vaga`. |

As abas no código são só **grupo, empresa e vaga** (`abas` em `GruposEmpresasPage.tsx`). Não existe aba "modelo" nesta tela: o modelo é o `ModeloFormPage`, servido pelas rotas `/vagas/modelos/*`. A consulta/lista de modelos (`/vagas/modelos`, `ConsultarModelosPage`) é do agente de Vagas.

Outras telas que abrem esta: `EmpresasPage` ("Nova empresa"), `EmpresaDetailPage` e `VagasPage` ("Nova vaga"), `NovasAbasPage.tsx:241` ("Abrir vaga" com `?aba=vaga&modelo=<vaga_id>`).

## Arquivos

Frontend
- `frontend/src/pages/GruposEmpresasPage.tsx` — `GruposEmpresasPage`, `AbaGrupo`, `AbaEmpresa`, `AbaVaga`, `ModeloFormPage` e as funções de horário (`diasPelaCarga`, `preencherDias`, `semFolga`, `soDiasFixos`, `textoPrevisto`, `cargaDoHorario`, `modosDoModelo`).
- `frontend/src/components/busca-opcao.tsx` — `BuscaOpcao`, `normalizarBusca`.
- `frontend/src/components/cobranca-empresa.tsx` — `CobrancaEmpresa` (compartilhado com `EmpresaDetailPage`).
- `frontend/src/lib/cargo.ts` — `cargoDoModelo`, `chaveCargo`, `nomePadronizado`, `CargoOpcao`.
- `frontend/src/lib/horario-escala.ts` — `DIAS_ESCALA`, `textoDoHorario`, tipos `DiaEscala`/`ModoDia`.
- Menu: `frontend/src/components/shell.tsx` (item "Grupos", página `empresas`; `/vagas/modelos/novo` → página `vagas-modelo`, `/vagas/modelos/...` → `vagas-modelos`).

Backend
- Rotas: `backend/src/routes/index.ts` — grupos/empresas/vagas (~747–770), modelos (~232–253).
- Service: `backend/src/services/cadastro.service.ts` (`CadastroService`) — grupos, empresas, vagas e modelos.
- Cargos: `backend/src/services/cargo.service.ts` (`CargoService`), `backend/src/lib/cargo.ts`.
- Cobrança do grupo: `backend/src/repositories/valor-empresa.repository.ts` (`valoresDoGrupo`).
- Schemas: `backend/src/schemas/cadastro.ts` (`grupoCreateSchema`, `empresaCadastroSchema`, `vagaCadastroSchema`, `modeloVagaSchema`), `backend/src/schemas/common.ts`.
- Libs usadas na vaga: `backend/src/lib/horario-escala.ts`, `backend/src/lib/money.ts`, `backend/src/lib/dates.ts` (`legacyToday`), `backend/src/lib/vaga-id.ts` (`reagruparVagaIds`), `backend/src/services/vagas-abertas-sync.service.ts` (`horarioDe`, `faixaDaSemana`).
- MySQL: `backend/src/db/mysql.ts`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/grupos` | Lista grupos (até 500, por nome) | `routes/index.ts:747` → `listarGrupos` |
| GET | `/api/v1/grupos/:id` | Grupo + empresas do grupo | `routes/index.ts:748` → `obterGrupo` |
| GET | `/api/v1/grupos/:id/cobranca` | Empresas do grupo com `cobranca` (ou `null`) | `routes/index.ts:751` → `valoresDoGrupo` |
| POST | `/api/v1/grupos` | Cria grupo | `routes/index.ts:754` → `criarGrupo` |
| GET | `/api/v1/grupos-empresas/empresas` | Empresas de `public.empresa` (até 500) para o seletor da vaga | `routes/index.ts:758` → `listarEmpresas` |
| POST | `/api/v1/grupos-empresas/empresas` | Cria (ou reativa) empresa no Lightsail e no Postgres | `routes/index.ts:759` → `criarEmpresa` |
| GET | `/api/v1/grupos-empresas/vagas` | Lista de modelos globais para o campo "Modelo" (resposta tem `modelos` e `data`) | `routes/index.ts:762` → `listarModelos` |
| POST | `/api/v1/grupos-empresas/vagas` | Abre a(s) vaga(s) | `routes/index.ts:768` → `criarVaga(body, request.user.email)` |
| GET | `/api/v1/cargos` | Lista de cargos | `routes/index.ts:757` → `CargoService.listar` |
| GET | `/api/v1/vagas/modelos/:vagaId` | Um modelo, no formato do formulário | `routes/index.ts:242` → `obterModelo` |
| POST | `/api/v1/vagas/modelos` | Cria modelo global (só `ModeloFormPage`) | `routes/index.ts:245` → `criarModelo` |
| PUT | `/api/v1/vagas/modelos/:vagaId` | Edita modelo global (só `ModeloFormPage`) | `routes/index.ts:248` → `editarModelo` |
| GET (externo) | `https://viacep.com.br/ws/<cep>/json/` | Preenche endereço ao sair do campo CEP (chamado do navegador) | `AbaEmpresa.buscarCep` |

(`GET /api/v1/vagas/modelos`, `/vagas/modelos/opcoes` e `DELETE /vagas/modelos/:vagaId` existem no mesmo `CadastroService`, mas são usados pela consulta de modelos — ver agente de Vagas.)

## Dados

Postgres, schema `public` (tabelas criadas/ajustadas por `MIRROR_SQL` em `cadastro.service.ts:34`, executado uma vez por processo em `ensureMirror`):
- `public.grupo` — `id`, `nome`, `email`, `telefone`, `criado_em`. Gravado por `criarGrupo`.
- `public.empresa` — `id` (uuid; igual ao `id_empresa` do Lightsail), `grupo_id`, `cnpj` (só dígitos, índice único `empresa_cnpj_digitos`), `razao_social`, `nome_fantasia`, `email`, `telefone`, `cep`, `logradouro`, `numero`, `complemento`, `latitude`, `longitude`, `local` ("bairro - cidade / UF"). Gravado por `criarEmpresa`.
- `public.vaga` — uma linha por posição aberta: `id`, `vaga_id` (agrupador), `grupo_id`, `empresa_id`, `tipo_vaga` (1 estágio, 2 CLT), `cargo`, `cargo_id`, `descricao`, `requisitos`, `salario` (numérico), `carga_horaria`, `sexo`, `idade`, `idade_ate`, `km` (30), `atividades`, `horario` (grade no formato do sync), `beneficios`, `cep`, `latitude`, `longitude`. Gravado por `criarVaga`.
- `public.vaga_repetida` — modelos globais (sem empresa/grupo): `vaga_id`, `tipo_vaga`, `cargo`, `cargo_id`, `descricao`, `requisitos`, `salario`, `carga_horaria`, `sexo`, `idade`, `idade_ate`, `km`, `atividades`, `horario` (texto por dia), `beneficios`. Lido por `listarModelos`/`obterModelo`, gravado por `criarModelo`/`editarModelo`.
- `public.cargo` — `id`, `nome` (padronizado), `chave` (única), `descricao`, `requisitos`. Lido sempre; gravado quando a vaga/modelo vem com `novo_cargo` e a chave ainda não existe.
- `public.valor_empresas` — só leitura (cobrança por empresa do grupo).

Postgres, schema `dna_work` (espelho do Lightsail, gravado junto):
- Empresa: `dna_work.empresa` (insert ou update com `status=1`, `sede=10`, `matriz=id`, `lat`/`lng`, `razao_sem_acento`/`fantasia_sem_acento`), `dna_work.assinaturas_empresa` (linhas `TCE` e `Convenio`, só em empresa nova).
- Vaga: `dna_work.codigo_vaga`, `dna_work.vaga` (uma por posição, `status=0`, `publicar=1`, `sede=10`, `faturar='S'`, `quantidade_posicoes=1`, `remoto=0`, `beneficios_texto`), `dna_work.etapa_vaga`, `dna_work.log_diversos` (ação "Abertura de vaga ADM" com o e-mail do usuário), `dna_work.vaga_valores` (por `comparador`, valores zerados), `dna_work.vaga_endereco`.

Lightsail MySQL (variáveis `DNA_WORK_DB_HOST`, `DNA_WORK_DB_PORT`, `DNA_WORK_DB_USER`, `DNA_WORK_DB_PASS`, `DNA_WORK_DB_NAME`; sem pool configurado → 503 `MYSQL_NAO_CONFIGURADO`):
- Empresa: lê `empresa` pelo CNPJ (dígitos); grava `empresa` (insert ou update de reativação) e `assinaturas_empresa` (só nova).
- Vaga: lê `empresa` (endereço), `codigo_vaga` e `vaga.comparador` (unicidade); grava `codigo_vaga`, `vaga`, `etapa_vaga`, `log_diversos`, `vaga_valores`, `vaga_endereco`.

Serviços externos:
- Google Geocoding (`https://maps.googleapis.com/maps/api/geocode/json`) com `GOOGLE_MAPS_API_KEY` — obrigatório para criar empresa (sem a chave → 503 `GOOGLE_NAO_CONFIGURADO`; sem resultado → 502 `GEOCODE_FALHOU`). Tenta endereço completo e depois só o CEP.
- ViaCEP — chamado direto do navegador na aba Empresa.

## Regras e comportamentos importantes

- **Grupo**: nome 2–180 caracteres e pelo menos e-mail **ou** telefone (`exigeContato`, `schemas/cadastro.ts:7`).
- **Empresa** (`criarEmpresa`, `cadastro.service.ts:469`):
  - `grupo_id` tem que existir em `public.grupo` (422 `GRUPO_OBRIGATORIO`).
  - CNPJ válido; se já estiver em `public.empresa` → 409 `CNPJ_JA_CADASTRADO`.
  - No Lightsail: mais de uma empresa com o CNPJ → 409 `CNPJ_AMBIGUO`; exatamente uma → **reativa** (reusa o `id_empresa`, atualiza dados, `status=1`) e responde `reativada: true`; nenhuma → cria com UUID novo.
  - CEP, logradouro, bairro, cidade e UF obrigatórios; número e complemento opcionais; e-mail ou telefone.
  - Gravação "dupla": abre transação no MySQL, grava no Postgres (`public.empresa` + `dna_work.empresa`) em outra transação, faz commit no Postgres e só então no MySQL. Se o MySQL falhar depois do Postgres, `reverterEmpresaPostgres` apaga `public.empresa` e desfaz/restaura `dna_work.empresa` com a prévia lida antes. Não é atômico de verdade (sem 2PC).
- **Vaga** (`criarVaga`, `cadastro.service.ts:594`):
  - A empresa tem que estar em `public.empresa` (422 `EMPRESA_FORA_DA_TELA`), ou seja, cadastrada por esta tela (ou sincronizada para lá).
  - Cargo: exatamente um entre `cargo_id` (da lista) e `novo_cargo` (`regrasDaVaga`). `novo_cargo` com chave já existente reaproveita o cargo existente e seus textos (`reaproveitado: true`, a tela avisa). A vaga sempre recebe nome, descrição e requisitos do cargo.
  - Estágio só carga 20/30; CLT só 40/44. `idade_ate` obrigatória e ≥ `idade`; idades 14–80; quantidade 1–20.
  - Cada posição vira uma linha (mesmo `codigo` no formato `AAA-0000`, mesmo `comparador` derivado do timestamp, mesmo `vaga_id` do lote). Depois, `reagruparVagaIds` recalcula `vaga_id` em `public.vaga` para juntar vagas iguais da mesma empresa (erro aí é ignorado; o sync corrige depois).
  - Horários: dias úteis sem horário usam entrada/saída base; sábado/domingo sem horário ficam vazios; folga e qualquer dia vazio são gravados como `"0"` nas colunas do legado. Texto da carga: "HH:MM às HH:MM" ou, com escala/folga em dia útil, o texto por dia (`textoDaVaga`). Coluna legada de domingo se chama `domindo_*`.
  - Mesma estratégia de gravação dupla da empresa; falha após o Postgres → `apagarVagaPostgres` remove o que foi gravado.
- **Modelo global** (`criarModelo`/`editarModelo`, `cadastro.service.ts:1008`): um por cargo (comparado pela `chaveCargo`) e modalidade; repetido → 409 `MODELO_JA_EXISTE`. Grava só em `public.vaga_repetida`, sempre com o horário em texto por dia (`textoDoModelo`). Apagar modelo não mexe nas vagas já abertas.
- **Formulário (frontend)**:
  - Trocar tipo volta a carga para 30 (estágio) ou 40 (CLT). Mudar entrada/saída/carga preenche os dias fixos a partir de segunda até cobrir a carga, sem sobrescrever dia editado à mão (`preencherDias`).
  - A carga é recalculada pelos dias **fixos** preenchidos: CLT ≥ 42 h → 44, senão 40; estágio ≥ 25 h → 30, senão 20 (`cargaDoHorario`). O backend faz o mesmo cálculo ao ler um modelo (`cargaCalculada`).
  - Dias de folga vão sem horário; dias de escala exigem horário.
  - Aplicar modelo preenche tudo menos empresa e quantidade; se o cargo do modelo não estiver na lista (por id ou chave), abre "+ Novo cargo" com o nome do modelo.
  - Texto digitado no campo cargo que coincide com um cargo da lista é resolvido para esse cargo ao salvar; se não coincide, vira "Novo cargo" e exige descrição e requisitos.
- **Permissões** (`lib/paginas.ts`): `/api/v1/grupos*` e `/api/v1/grupos-empresas*` exigem a página `empresas`; `/api/v1/cargos` aceita `empresas`, `vagas`, `vagas-modelos` ou `vagas-modelo`; `/api/v1/vagas/modelos*` exige uma das páginas de vagas. Consequência: quem só tem `empresas` consegue abrir vaga, mas `?aba=vaga&modelo=...` falha (403) ao buscar o modelo.

## Cuidados ao mudar

- `ensureMirror` roda `CREATE TABLE/INDEX IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` em produção na primeira chamada. Mudanças em `MIRROR_SQL` alteram o schema do Postgres real.
- A gravação em dois bancos depende da ordem: transação MySQL aberta → Postgres commit → MySQL commit → compensação manual. Ao adicionar uma tabela, inclua o insert nos dois lados **e** no rollback manual (`reverterEmpresaPostgres` / `apagarVagaPostgres`).
- As colunas e valores fixos do legado (`sede=10`, `tipo_empresa=1`, `usa_agente=1`, `etapa_vaga` padrão, `vaga_valores` zerado, `km=30`) imitam o sistema antigo; outras telas e o portal leem esses valores.
- `public.vaga.vaga_id` é recalculado por `reagruparVagaIds` (assinatura em `lib/vaga-id.ts`); triagem e sync de vagas abertas dependem desse agrupamento.
- `formularioDaLinha` entende dois formatos de `horario` (texto por dia e grade do sync `;turno;...;1=HH:MM-HH:MM`); mantenha os dois.
- `AbaVaga` é usado nos dois modos; mudanças no formulário de vaga afetam também `ModeloFormPage` e a consulta de modelos (invalida `modelos-consulta` e navega para `/vagas/modelos`).
- `GET /api/v1/grupos-empresas/vagas` devolve `{ success, modelos, data }` (sem `meta`), diferente do padrão `ok()`.
- Listas de grupos e empresas têm `LIMIT 500` e o filtro é feito no navegador: acima disso, itens somem do seletor.
- `valoresDoGrupo` usa `public.empresa.id` para buscar `public.valor_empresas.id_empresa`; funciona porque o id é o mesmo do Lightsail.
- Depois de salvar empresa, a tela invalida `["grupo"]` e `["empresas-tela"]`, não a lista de `/empresas` (`["empresas"]`).

## Como testar

- Manual (só em base de teste: empresa e vaga gravam no Lightsail real e no Postgres, e a empresa chama o Google): criar grupo sem e-mail e sem telefone (deve recusar); criar empresa com CNPJ já existente; abrir vaga escolhendo modelo, trocando tipo/carga/horários e marcando escala/folga; abrir vaga com "+ Novo cargo" com nome igual a um cargo existente (aviso de reaproveitamento); em `/vagas/modelos/novo`, criar um modelo e tentar criar outro com o mesmo cargo e tipo (409).
- Testes backend:
  - `backend/test/cadastro-validacao.test.ts`: regras de grupo, empresa e vaga nos schemas.
  - `backend/test/cargo.test.ts`: chave/nome padronizado, criação e reaproveitamento de cargo, cargo da lista vs. novo, cargo de modelo antigo.
  - `backend/test/vaga-id.test.ts`: assinatura/reagrupamento de `vaga_id`.
  - `backend/test/horario-escala.test.ts`: texto de horário por dia.
  - Não encontrado teste de integração de `criarEmpresa`/`criarVaga` (dependem de MySQL e Google).
- Frontend: sem teste específico.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
