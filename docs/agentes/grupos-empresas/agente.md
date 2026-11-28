# Agente — Grupos (Grupos, Empresas e Vagas)

> Última revisão: 2026-11-28 (abrir vaga: localização e CEP da empresa na busca e abaixo do campo Empresa)

## Para que serve

Tela de cadastro em cascata: primeiro o grupo, depois a empresa do grupo, depois a vaga da empresa. É aqui que se cria empresa nova (gravando só no Postgres, com geocodificação) e que se abrem vagas (uma ou várias posições de uma vez, opcionalmente a partir de um modelo global). O mesmo formulário de vaga, sem empresa e sem quantidade, é usado para criar/editar modelos globais (`ModeloFormPage`).

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/grupos-empresas` ou `?aba=grupo` | `GruposEmpresasPage` → `AbaGrupo` | `frontend/src/pages/GruposEmpresasPage.tsx` | `CabecalhoPagina` "Grupos, empresas e vagas" e as abas em `FiltroChips` (Grupo, Empresa, Vaga). Formulário "Novo grupo" à esquerda + lista pesquisável de grupos à direita (filtro no navegador, contador, cada grupo com seta para abrir). |
| `/grupos-empresas?aba=grupo&grupo=<uuid>` | `AbaGrupo` (selecionado) | idem | "Voltar para os grupos"; cartão do grupo com contato, link "Cadastrar empresa neste grupo" (`?aba=empresa&grupo=<uuid>`) e a tabela `data-table` "Empresas do grupo" (clique ou "Abrir" leva a `/empresas/:id`); "Vagas do grupo" (`VagasDoGrupo`: botões Aberta, Pausada, Contratada, Fechada e Todas com a contagem, o número de vagas e o de posições disponíveis da situação escolhida em destaque (ex.: "13 vagas abertas · 16 posições disponíveis") e "Ver vagas" para expandir a lista paginada; aparece só quando o grupo tem empresa); "Cobrança das empresas" (`CobrancaEmpresa` por empresa). |
| `/grupos-empresas?aba=empresa[&grupo=<uuid>]` | `AbaEmpresa` | idem | Formulário de empresa nova em 3 blocos numerados (`Bloco` + grade de 6 colunas): 1 Grupo e identificação (grupo, CNPJ opcional, razão social, fantasia), 2 Endereço (CEP com ViaCEP, endereço, número, complemento, bairro, cidade, UF), 3 Contato. "Salvar empresa" no fim. |
| `/grupos-empresas?aba=vaga[&empresa=<uuid>][&modelo=<vaga_id>]` | `AbaVaga` (modo `vaga`) | idem | Formulário de abertura de vaga em 5 blocos numerados: 1 Empresa e modelo (empresa — a lista mostra embaixo de cada empresa o CNPJ e a localização (`localizacaoDa`: logradouro, número, complemento, `local` "bairro - cidade / UF" e CEP) e busca também por eles; depois de escolher, CNPJ, razão social e localização aparecem abaixo do campo —, modelo opcional, quantidade), 2 Cargo e remuneração (tipo, carga, cargo da lista ou "+ Novo cargo", salário), 3 Horário (entrada, saída, dias fixo/escala/folga, texto previsto), 4 Perfil do candidato (sexo, idade de/até e, só no estágio, "Aceita ensino médio?" obrigatório), 5 Atividades e benefícios. Botão "Abrir vaga" no fim. |
| `/vagas/modelos/novo` | `ModeloFormPage` → `AbaVaga` (modo `modelo`) | idem | "Novo modelo de vaga": os mesmos blocos sem o bloco da empresa (a numeração começa em Cargo e remuneração). "Voltar aos modelos" no cabeçalho; Cancelar/Salvar modelo no fim. Salvar volta para `/vagas/modelos`. |
| `/vagas/modelos/:id/editar` | `ModeloFormPage` → `AbaVaga` (modo `modelo`) | idem | "Editar modelo de vaga": mesmo formulário, já preenchido com o modelo. |
| `/empresas/nova`, `/vagas/nova` | `Navigate` | `frontend/src/App.tsx:74`, `:81` | Redirecionam para `?aba=empresa` e `?aba=vaga`. |

As abas no código são só **grupo, empresa e vaga** (`abas` em `GruposEmpresasPage.tsx`). Não existe aba "modelo" nesta tela: o modelo é o `ModeloFormPage`, servido pelas rotas `/vagas/modelos/*`. A consulta/lista de modelos (`/vagas/modelos`, `ConsultarModelosPage`) é do agente de Vagas.

Outras telas que abrem esta: `EmpresasPage` ("Nova empresa"), `EmpresaDetailPage` e `VagasPage` ("Nova vaga"), `NovasAbasPage.tsx` (`AcoesModelo`, "Abrir vaga" com `?aba=vaga&modelo=<vaga_id>`).

## Arquivos

Frontend
- `frontend/src/pages/GruposEmpresasPage.tsx` — `GruposEmpresasPage`, `AbaGrupo`, `AbaEmpresa`, `AbaVaga`, `ModeloFormPage`, os componentes visuais locais (`Bloco`, `Grade`, `Celula`, `Sucesso`, `Aviso`, `Erro`, estes dois com `Alerta`) e as funções de horário (`diasPelaCarga`, `preencherDias`, `semFolga`, `soDiasFixos`, `textoPrevisto`, `cargaDoHorario`, `modosDoModelo`).
- `frontend/src/components/busca-opcao.tsx` — `BuscaOpcao`, `normalizarBusca`.
- `frontend/src/components/cobranca-empresa.tsx` — `CobrancaEmpresa` (compartilhado com `EmpresaDetailPage`).
- `frontend/src/components/pagina.tsx` — `CabecalhoPagina`, `FiltroChips` (abas), `Alerta`.
- `frontend/src/lib/cargo.ts` — `cargoDoModelo`, `chaveCargo`, `nomePadronizado`, `CargoOpcao`.
- `frontend/src/lib/horario-escala.ts` — `DIAS_ESCALA`, `textoDoHorario`, tipos `DiaEscala`/`ModoDia`.
- Menu: `frontend/src/components/shell.tsx` (item "Grupos", página `empresas`; `/vagas/modelos/novo` → página `vagas-modelo`, `/vagas/modelos/...` → `vagas-modelos`).

Backend
- Rotas: `backend/src/routes/index.ts` — grupos/empresas/vagas (~747–770), modelos (~232–253).
- Service: `backend/src/services/cadastro.service.ts` (`CadastroService`) — grupos, empresas, vagas e modelos.
- Cargos: `backend/src/services/cargo.service.ts` (`CargoService`), `backend/src/lib/cargo.ts`.
- Cobrança do grupo: `backend/src/repositories/valor-empresa.repository.ts` (`valoresDoGrupo`).
- Vagas do grupo: `VagaService.doGrupo` (`backend/src/services/vaga.service.ts`) usa `VagaRepository.contarPorSituacao` e `VagaRepository.vagasJuntasDoGrupo`, que partilham o SQL `sqlGruposDoGrupo` (`backend/src/repositories/vaga.repository.ts`). Não usa a `list` de Consultar Vagas, porque junta as vagas repetidas.
- Schemas: `backend/src/schemas/cadastro.ts` (`grupoCreateSchema`, `empresaCadastroSchema`, `vagaCadastroSchema`, `modeloVagaSchema`), `backend/src/schemas/common.ts`.
- Libs usadas na vaga: `backend/src/lib/horario-escala.ts`, `backend/src/lib/money.ts`, `backend/src/lib/dates.ts` (`legacyToday`), `backend/src/lib/vaga-id.ts` (`reagruparVagaIds`), `backend/src/services/vagas-abertas-sync.service.ts` (`horarioDe`, `faixaDaSemana`).
- MySQL: não é mais usado (o `db/mysql.ts` foi removido em 18/11/2026).

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/grupos` | Lista grupos (até 500, por nome) | `routes/index.ts:747` → `listarGrupos` |
| GET | `/api/v1/grupos/:id` | Grupo + empresas do grupo | `routes/index.ts:748` → `obterGrupo` |
| GET | `/api/v1/grupos/:id/cobranca` | Empresas do grupo com `cobranca` (ou `null`) | `routes/index.ts:751` → `valoresDoGrupo` |
| GET | `/api/v1/grupos/:id/vagas?situacao&page&pageSize` | `{ contagem, disponiveis, vagas }` + `meta.total` (total de vagas já juntas). Cada item de `vagas` traz também `linhas` (quantas aberturas juntou) e `codigos`. `contagem` e `disponiveis` têm `aberta`, `pausada`, `contratada`, `fechada` e `total` (vagas e posições livres). As duas somam todas as empresas do grupo e não depende do filtro; `vagas` é a página da lista na `situacao` pedida (sem `situacao`, todas). | `routes/index.ts` → `VagaService.doGrupo` |
| POST | `/api/v1/grupos` | Cria grupo | `routes/index.ts:754` → `criarGrupo` |
| GET | `/api/v1/grupos-empresas/empresas` | Empresas de `public.empresa` (até 500) para o seletor da vaga, com CNPJ e endereço (`cep`, `logradouro`, `numero`, `complemento`, `local`) | `routes/index.ts:758` → `listarEmpresas` |
| POST | `/api/v1/grupos-empresas/empresas` | Cria (ou reativa) empresa no Postgres | `routes/index.ts:759` → `criarEmpresa` |
| GET | `/api/v1/grupos-empresas/vagas` | Lista de modelos globais para o campo "Modelo" (resposta tem `modelos` e `data`) | `routes/index.ts:762` → `listarModelos` |
| POST | `/api/v1/grupos-empresas/vagas` | Abre a(s) vaga(s) | `routes/index.ts:768` → `criarVaga(body, request.user.email)` |
| POST | `/api/v1/servico/vagas` | Portal das empresas abre vaga (header `x-service-token` = `SERVICE_TOKEN`, sem login; corpo = `vagaCadastroSchema` + `usuario`) | `app.ts` → `criarVaga(body, "Portal empresa: <usuario>", "Abertura de vaga Portal empresa")` |
| GET | `/api/v1/cargos` | Lista de cargos | `routes/index.ts:757` → `CargoService.listar` |
| GET | `/api/v1/vagas/modelos/:vagaId` | Um modelo, no formato do formulário | `routes/index.ts:242` → `obterModelo` |
| POST | `/api/v1/vagas/modelos` | Cria modelo global (só `ModeloFormPage`) | `routes/index.ts:245` → `criarModelo` |
| PUT | `/api/v1/vagas/modelos/:vagaId` | Edita modelo global (só `ModeloFormPage`) | `routes/index.ts:248` → `editarModelo` |
| GET (externo) | `https://viacep.com.br/ws/<cep>/json/` | Preenche endereço ao sair do campo CEP (chamado do navegador) | `AbaEmpresa.buscarCep` |

(`GET /api/v1/vagas/modelos`, `/vagas/modelos/opcoes` e `DELETE /vagas/modelos/:vagaId` existem no mesmo `CadastroService`, mas são usados pela consulta de modelos — ver agente de Vagas.)

## Dados

Postgres, schema `public` (tabelas criadas/ajustadas por `MIRROR_SQL` em `cadastro.service.ts:34`, executado uma vez por processo em `ensureMirror`):
- `public.grupo` — `id`, `nome`, `email`, `telefone`, `criado_em`. Gravado por `criarGrupo`.
- `public.empresa` — `id` (uuid; igual ao `id_empresa` do Lightsail), `grupo_id`, `cnpj` (só dígitos ou `NULL` quando a empresa não tem CNPJ; índice único `empresa_cnpj_digitos`, que aceita vários `NULL`; o `MIRROR_SQL` faz `ALTER COLUMN cnpj DROP NOT NULL`), `razao_social`, `nome_fantasia`, `email`, `telefone`, `cep`, `logradouro`, `numero`, `complemento`, `latitude`, `longitude`, `local` ("bairro - cidade / UF"). Gravado por `criarEmpresa`.
- `public.vaga` — uma linha por posição aberta: `id`, `vaga_id` (agrupador), `grupo_id`, `empresa_id`, `tipo_vaga` (1 estágio, 2 CLT), `cargo`, `cargo_id`, `descricao`, `requisitos`, `salario` (numérico), `carga_horaria`, `sexo`, `idade`, `idade_ate`, `km` (30), `atividades`, `horario` (grade no formato do sync), `beneficios`, `escolaridade`, `cep`, `latitude`, `longitude`. Gravado por `criarVaga`.
- `public.vaga_repetida` — modelos globais (sem empresa/grupo): `vaga_id`, `tipo_vaga`, `cargo`, `cargo_id`, `descricao`, `requisitos`, `salario`, `carga_horaria`, `sexo`, `idade`, `idade_ate`, `km`, `atividades`, `horario` (texto por dia), `beneficios`. Lido por `listarModelos`/`obterModelo`, gravado por `criarModelo`/`editarModelo`.
- `public.cargo` — `id`, `nome` (padronizado), `chave` (única), `descricao`, `requisitos`. Lido sempre; gravado quando a vaga/modelo vem com `novo_cargo` e a chave ainda não existe.
- `public.valor_empresas` — só leitura (cobrança por empresa do grupo).

Postgres, schema `dna_work` (cadastro do sistema; o Lightsail foi desligado em 18/11/2026 e não é mais lido nem gravado):
- Empresa: `dna_work.empresa` (insert ou update com `status=1`, `sede=10`, `matriz=id`, `lat`/`lng`, `razao_sem_acento`/`fantasia_sem_acento`), `dna_work.assinaturas_empresa` (linhas `TCE` e `Convenio`, só em empresa nova).
- Vaga: `dna_work.codigo_vaga`, `dna_work.vaga` (uma por posição, `status=0`, `publicar=1`, `sede=10`, `faturar='S'`, `quantidade_posicoes=1`, `remoto=0`, `beneficios_texto`), `dna_work.etapa_vaga`, `dna_work.log_diversos` (ação "Abertura de vaga ADM" com o e-mail do usuário, ou "Abertura de vaga Portal empresa" quando vem do portal), `dna_work.vaga_valores` (por `comparador`, valores zerados), `dna_work.vaga_endereco`.

Leituras de apoio, também no Postgres: `dna_work.empresa` pelo CNPJ (reativação) e pelo id (endereço da vaga), `dna_work.codigo_vaga` e `dna_work.vaga.comparador` (unicidade).

Serviços externos:
- Google Geocoding (`https://maps.googleapis.com/maps/api/geocode/json`) com `GOOGLE_MAPS_API_KEY` — obrigatório para criar empresa (sem a chave → 503 `GOOGLE_NAO_CONFIGURADO`; sem resultado → 502 `GEOCODE_FALHOU`). Tenta endereço completo e depois só o CEP.
- ViaCEP — chamado direto do navegador na aba Empresa.

## Regras e comportamentos importantes

- **Cobrada pelo CNPJ de outra empresa** (`backend/src/lib/cobranca-pela-matriz.ts`): é o esquema de filial cobrada pela matriz que o sistema antigo já usava (Confiança, Flex, Enxuto). Escolher a empresa que paga grava na unidade `matriz` = id de quem paga, `usa_asaas` = 2, `tipo_empresa` = 2, `sede` = 10 e o `datafechamento` de quem paga, e copia as condições de cobrança que a unidade ainda não tem: as linhas de `dna_work.faturamento_empresa` (por modalidade; `id` = max + 1 com a tabela travada) e a linha de `public.valor_empresas` (com o CNPJ de quem paga e `tipo` "Filial"). As que a unidade já tem não são trocadas. O faturamento junta a unidade na matriz, o boleto sai no CNPJ dela, o relatório consolidado mostra a coluna Unidade e a régua manda para o e-mail da matriz; as vagas continuam com o endereço da própria unidade. Só pode pagar empresa ativa, com CNPJ e faturada por ela mesma (`usa_asaas` 1, ou 2 sendo a própria matriz): senão 422 `COBRANCA_NAO_FATURADA`, `COBRANCA_SEM_CNPJ` ou `COBRANCA_INVALIDA`. Lista das opções: `GET /api/v1/empresas/pagadoras?grupo&excluir&q` (as do mesmo grupo primeiro). Na "Nova empresa", o bloco 1 tem "Cobrar pelo CNPJ de" (`EscolherPagadora`), **obrigatório quando o CNPJ fica em branco** (no schema: `cobranca_por`, mensagem "Empresa sem CNPJ: escolha por qual CNPJ ela vai ser cobrada."). `criarEmpresa` liga a unidade a quem paga na mesma transação do cadastro e devolve `cobranca_por`. Empresa nova sem esse campo continua sem `usa_asaas` (não entra no faturamento até alguém configurar a cobrança).
- **Tamanho dos campos** (2026-11-18): `dna_work.log_diversos.usuario` e `.acao` são `varchar(40)`. O `criarVaga` grava `usuario.slice(0, 40)` e `acao.slice(0, 40)`. Antes gravava até 120 e, com e-mail longo (portal: `Portal empresa: <e-mail>` passa de 40 com e-mail de mais de 24 letras), o Postgres recusava, a transação inteira era desfeita e a vaga não abria. No cadastro de empresa, `numero` vai até 10 e `bairro` até 50 (`schemas/cadastro.ts`), o tamanho das colunas de `dna_work.empresa` e `dna_work.vaga_endereco`; texto maior dá 422 com mensagem, em vez de falhar na gravação.
- **Erro 502 vira 500** (`app.ts`, `setErrorHandler`): o Easypanel troca toda resposta 502 pela página "Service is not reachable" e a mensagem real se perde. Os `AppError(502, …)` (gravação, OpenAI, CRM, Asaas, ZapSign…) saem como 500, com o mesmo código e mensagem.
- **Busca de grupos** (lista da aba Grupo): usa `combinaBusca` (cada palavra em nome, e-mail ou telefone, em qualquer ordem e sem acento).
- Cadastro de empresa (`empresaCadastroSchema`): razão social e nome fantasia perdem entidades HTML (`&amp;` → `&`) antes de gravar, com mensagens de tamanho em português.

- **Grupo**: nome 2–180 caracteres e pelo menos e-mail **ou** telefone (`exigeContato`, `schemas/cadastro.ts:7`).
- **Empresa** (`criarEmpresa`, `cadastro.service.ts:469`):
  - `grupo_id` tem que existir em `public.grupo` (422 `GRUPO_OBRIGATORIO`).
  - **CNPJ opcional** (`optionalCnpj` em `schemas/common.ts`): em branco vira "sem CNPJ"; preenchido tem que ser válido. Sem CNPJ não há checagem de duplicidade nem reativação: é sempre empresa nova (UUID novo), gravada com `cnpj` `NULL` no Postgres (`public.empresa` e `dna_work.empresa`) e `''` no Lightsail (a coluna do legado pode não aceitar `NULL`).
  - **Trava da empresa sem CNPJ** (`barrarEmpresaSemCnpjRepetida` + `empresaParecida`): recusa com 409 `EMPRESA_JA_CADASTRADA` (`details.id_empresa`) quando já existe empresa com o **mesmo CEP** e a razão social ou o nome fantasia iguais (qualquer combinação entre os dois lados, ignorando acento, caixa, espaço e pontuação; `chaveDoNome`). Procura em `public.empresa` e nas ativas (`status = 1`) de `dna_work.empresa`. Mesmo nome em CEP diferente (filial) passa.
  - Com CNPJ: se já estiver em `public.empresa` → 409 `CNPJ_JA_CADASTRADO`.
  - Em `dna_work.empresa` (só com CNPJ): mais de uma empresa com o CNPJ → 409 `CNPJ_AMBIGUO`; exatamente uma → **reativa** (reusa o `id_empresa`, atualiza dados, `status=1`) e responde `reativada: true`; nenhuma → cria com UUID novo.
  - CEP, logradouro, bairro, cidade e UF obrigatórios; número e complemento opcionais; e-mail ou telefone.
  - Gravação numa transação só do Postgres (`public.empresa` + `dna_work.empresa` via `gravarEmpresaNoCadastro`): se algo falhar, nada fica gravado.
- **Vaga** (`criarVaga`, `cadastro.service.ts:594`):
  - A empresa tem que estar em `public.empresa` (422 `EMPRESA_FORA_DA_TELA`), ou seja, cadastrada por esta tela (ou sincronizada para lá).
  - Cargo: exatamente um entre `cargo_id` (da lista) e `novo_cargo` (`regrasDaVaga`). `novo_cargo` com chave já existente reaproveita o cargo existente e seus textos (`reaproveitado: true`, a tela avisa). A vaga sempre recebe nome, descrição e requisitos do cargo.
  - Estágio só carga 20/30; CLT só 40/44. `idade_ate` obrigatória e ≥ `idade`; idades 14–80; quantidade 1–20.
  - Cada posição vira uma linha (mesmo `codigo` no formato `AAA-0000`, mesmo `comparador` derivado do timestamp, mesmo `vaga_id` do lote). Depois, `reagruparVagaIds` recalcula `vaga_id` em `public.vaga` para juntar vagas iguais da mesma empresa (erro aí é ignorado; o sync corrige depois).
  - Horários: dias úteis sem horário usam entrada/saída base; sábado/domingo sem horário ficam vazios; folga e qualquer dia vazio são gravados como `"0"` nas colunas do legado. Texto da carga: "HH:MM às HH:MM" ou, com escala/folga em dia útil, o texto por dia (`textoDaVaga`). Coluna legada de domingo se chama `domindo_*`.
  - Mesma estratégia de gravação dupla da empresa; falha após o Postgres → `apagarVagaPostgres` remove o que foi gravado.
- **Aceita ensino médio** (só estágio, obrigatório em `vagaCadastroSchema`; aceita `"sim"`/`"nao"` ou booleano): "sim" grava `escolaridade = '31'` (código de "Ensino médio" em `dna_work.flex`) no Lightsail, em `public.vaga` e em `dna_work.vaga`; "não" ou CLT deixam `escolaridade` vazia. É o mesmo código que o termo e a rescisão de ensino médio (`termo.service.ts`) e a triagem leem. Não entra no modelo global.
- **Portal das empresas** (`POST /api/v1/servico/vagas`): usa exatamente o mesmo `criarVaga`, então a vaga aparece em Vagas, na triagem e no Lightsail como uma vaga aberta aqui. A empresa precisa estar em `public.empresa` (senão 422 `EMPRESA_FORA_DA_TELA`, e o portal grava só em `dna_work.vaga`).
- **Modelo global** (`criarModelo`/`editarModelo`, `cadastro.service.ts:1008`): um por cargo (comparado pela `chaveCargo`) e modalidade; repetido → 409 `MODELO_JA_EXISTE`. Grava só em `public.vaga_repetida`, sempre com o horário em texto por dia (`textoDoModelo`). Apagar modelo não mexe nas vagas já abertas.
- **Formulário (frontend)**:
  - Trocar tipo volta a carga para 30 (estágio) ou 40 (CLT). Mudar entrada/saída/carga preenche os dias fixos a partir de segunda até cobrir a carga, sem sobrescrever dia editado à mão (`preencherDias`).
  - A carga é recalculada pelos dias **fixos** preenchidos: CLT ≥ 42 h → 44, senão 40; estágio ≥ 25 h → 30, senão 20 (`cargaDoHorario`). O backend faz o mesmo cálculo ao ler um modelo (`cargaCalculada`).
  - Dias de folga vão sem horário; dias de escala exigem horário.
  - Aplicar modelo preenche tudo menos empresa e quantidade; se o cargo do modelo não estiver na lista (por id ou chave), abre "+ Novo cargo" com o nome do modelo.
  - Texto digitado no campo cargo que coincide com um cargo da lista é resolvido para esse cargo ao salvar; se não coincide, vira "Novo cargo" e exige descrição e requisitos.
- **Vagas do grupo, vagas repetidas**: o sistema grava uma linha por posição (abrir 3 posições = 3 linhas de 1) e a mesma vaga às vezes é aberta de novo em outro dia. Aqui, linhas da **mesma empresa** com o mesmo **cargo** (sem diferenciar caixa e espaços), **modalidade, salário, horário** (texto da carga ou entrada/saída), **sexo e idade de/até**, na **mesma situação**, viram uma linha só, com posições, ocupadas e disponíveis somadas, a abertura mais recente e os códigos de todas ("2 aberturas · EQK-7174, JZA-9866"). "Abrir" leva à abertura mais recente. A prioridade da linha é a maior entre as juntas. Carga horária (40/44) e benefícios **não** entram na regra (foi a escolha do usuário: juntar pelo que aparece na lista), então duas aberturas que só diferem nisso viram uma. O número de vagas conta essas linhas já juntas. Consultar Vagas (`/vagas`) e a Triagem não mudam: lá continua uma linha por registro (a Triagem junta pelo `vaga_id`, que considera todos os campos).
- **Vagas do grupo**: a vaga entra pelo grupo da empresa em `public.empresa` (`public.empresa.id = dna_work.vaga.id_empresa`), igual ao filtro Grupo de Consultar Vagas. Empresa que não está em `public.empresa` não entra. A situação segue `lib/vaga-status.ts`: código desconhecido ou nulo conta como fechada. O número principal conta vagas já juntas (ver acima); ao lado vêm as posições disponíveis, com a mesma conta de `posicoesLivres` (posições da vaga, ou 1 se vazio, menos contratações com `CONTRATACAO_STATUS_ATIVO`, nunca abaixo de zero). Uma vaga com 2 posições conta 1 vaga e 2 posições. As posições disponíveis só aparecem em Aberta e Pausada; em Todas aparecem as das abertas ("nas vagas abertas"); em Contratada e Fechada não aparecem, porque a conta não olha a situação e uma vaga fechada sem contratação daria "posições disponíveis". A lista vem da abertura mais recente para a mais antiga; "Abrir" leva a `/vagas/:id`, que exige a página de Vagas.
- **Permissões** (`lib/paginas.ts`): `/api/v1/grupos*` e `/api/v1/grupos-empresas*` exigem a página `empresas`; `/api/v1/cargos` aceita `empresas`, `vagas`, `vagas-modelos` ou `vagas-modelo`; `/api/v1/vagas/modelos*` exige uma das páginas de vagas. Consequência: quem só tem `empresas` consegue abrir vaga, mas `?aba=vaga&modelo=...` falha (403) ao buscar o modelo.

## Cuidados ao mudar

- `ensureMirror` roda `CREATE TABLE/INDEX IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` em produção na primeira chamada. Mudanças em `MIRROR_SQL` alteram o schema do Postgres real.
- Empresa e vaga gravam numa transação do Postgres cada. Ao adicionar uma tabela, inclua o insert dentro dessa transação.
- As colunas e valores fixos do legado (`sede=10`, `tipo_empresa=1`, `usa_agente=1`, `etapa_vaga` padrão, `vaga_valores` zerado, `km=30`) imitam o sistema antigo; outras telas e o portal leem esses valores.
- `public.vaga.vaga_id` é recalculado por `reagruparVagaIds` (assinatura em `lib/vaga-id.ts`); triagem e sync de vagas abertas dependem desse agrupamento.
- `formularioDaLinha` entende dois formatos de `horario` (texto por dia e grade do sync `;turno;...;1=HH:MM-HH:MM`); mantenha os dois.
- `AbaVaga` é usado nos dois modos; mudanças no formulário de vaga afetam também `ModeloFormPage` e a consulta de modelos (invalida `modelos-consulta` e navega para `/vagas/modelos`). A numeração dos blocos vem de `ordemBlocos`/`numero` (o modo modelo não tem o bloco da empresa).
- `GET /api/v1/grupos-empresas/vagas` devolve `{ success, modelos, data }` (sem `meta`), diferente do padrão `ok()`.
- Listas de grupos e empresas têm `LIMIT 500` e o filtro é feito no navegador: acima disso, itens somem do seletor.
- `valoresDoGrupo` usa `public.empresa.id` para buscar `public.valor_empresas.id_empresa`; funciona porque o id é o mesmo do Lightsail.
- Depois de salvar empresa, a tela invalida `["grupo"]` e `["empresas-tela"]`, não a lista de `/empresas` (`["empresas"]`).

## Como testar

- Manual (só em base de teste: empresa e vaga gravam no Postgres, e a empresa chama o Google): criar grupo sem e-mail e sem telefone (deve recusar); criar empresa com CNPJ já existente; criar empresa com o CNPJ em branco e abrir vaga para ela; abrir vaga escolhendo modelo, trocando tipo/carga/horários e marcando escala/folga; abrir vaga com "+ Novo cargo" com nome igual a um cargo existente (aviso de reaproveitamento); em `/vagas/modelos/novo`, criar um modelo e tentar criar outro com o mesmo cargo e tipo (409).
- Testes backend:
  - `backend/test/cadastro-validacao.test.ts`: regras de grupo, empresa (inclusive CNPJ opcional) e vaga nos schemas (inclusive "aceita ensino médio" obrigatório no estágio).
  - `backend/test/cargo.test.ts`: chave/nome padronizado, criação e reaproveitamento de cargo, cargo da lista vs. novo, cargo de modelo antigo.
  - `backend/test/vaga-id.test.ts`: assinatura/reagrupamento de `vaga_id`.
  - `backend/test/horario-escala.test.ts`: texto de horário por dia.
  - Não encontrado teste de integração de `criarEmpresa`/`criarVaga` (dependem de MySQL e Google).
- Frontend: sem teste específico.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
