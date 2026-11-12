# Agente — Vagas

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Aqui o usuário consulta todas as vagas (cópia do Lightsail em `dna_work.vaga`) com filtros por cargo, grupo, empresa, modalidade e situação, e muda a situação direto na lista. Também pode abrir a ficha de uma vaga, com funil, mensagem para o candidato, candidatos sugeridos e contratados, e editar a vaga. Em "Consultar Modelos", mantém os **modelos globais de vaga** (um por cargo e modalidade, em `public.vaga_repetida`), que preenchem o formulário de abertura de vaga. As vagas abertas usadas pela Triagem (`public.vaga`) vêm de syncs automáticos a partir do Lightsail, do Notion e de `public.cargo`.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/vagas` | `VagasPage` | `frontend/src/pages/VagasPage.tsx` | Menu "Consultar". Filtros (Cargo, Grupo, Empresa, Modalidade, Situação) na URL, tabela em telas largas e cartões em telas estreitas, ocupação das posições, tempo em aberto, selo de situação clicável (`StatusEditavel`) e paginação de 20, 25, 50 ou 100. |
| `/vagas/modelos` | `ConsultarModelosPage` | `frontend/src/pages/NovasAbasPage.tsx` (linha 180) | Menu "Consultar Modelos". Busca por cargo (com sugestões) e modalidade. Tabela com Cargo, Modalidade, Salário, Carga, Horário e as ações Abrir vaga, Editar e Apagar. |
| `/vagas/modelos/novo` e `/vagas/modelos/:id/editar` | `ModeloFormPage` → `AbaVaga modo="modelo"` | `frontend/src/pages/GruposEmpresasPage.tsx` (linhas 452-741) | Formulário do modelo: o mesmo da abertura de vaga, sem empresa e sem quantidade. |
| `/vagas/:id` | `VagaDetailPage` | `frontend/src/pages/VagaDetailPage.tsx` | Ficha da vaga: cabeçalho com Fechar/Reabrir, Novo processo, Contratar e Editar; os blocos Abertura, Inscritos, Entrevista e Contrato; as 4 etapas; mensagem para o candidato (copiar); informações gerais; candidatos sugeridos; quem já trabalhou; contratados; processos relacionados (`ProcessosRelacionados` de `ProcessosPage.tsx`). |
| `/vagas/:id/editar` | `VagaFormPage` | `frontend/src/pages/VagaFormPage.tsx` | Edição da vaga: cargo, situação, modalidade, salário, quantidade, km, carga, sexo, horário por dia (Fixo/Escala/Folga), texto do horário, atividades, benefícios, requisitos, destaques e observações. A empresa fica travada. |
| `/vagas/nova` | — | `frontend/src/App.tsx:81` | Redireciona para `/grupos-empresas?aba=vaga`. A abertura de vaga mora na tela de Grupos e Empresas (`AbaVaga modo="vaga"`). |

Menu: `vagaLinks` em `frontend/src/components/shell.tsx` (linhas 36-39). Para liberar as telas, `paginaDoCaminho` (shell.tsx:58-88) faz este mapa: `/vagas/modelos/novo` → `vagas-modelo`; `/vagas/modelos` e subrotas (inclusive `/:id/editar`) → `vagas-modelos`; o resto de `/vagas` → `vagas`.

`CadastrarModeloPage` (NovasAbasPage.tsx:253) é um formulário estático, sem chamadas à API, e não está em nenhuma rota do `App.tsx`.

## Arquivos

**Frontend**
- `frontend/src/pages/VagasPage.tsx`: `VagasPage`, `Modalidade`, `Ocupacao`, `Disponiveis`, `TempoAberto`, `StatusEditavel` (menu em portal, pede confirmação antes de gravar).
- `frontend/src/pages/VagaDetailPage.tsx`: `VagaDetailPage`, `MensagemVaga`.
- `frontend/src/pages/VagaFormPage.tsx`: edição (react-hook-form + zod).
- `frontend/src/pages/NovasAbasPage.tsx`: `ConsultarModelosPage` e `Pesquisa` (campo com sugestões).
- `frontend/src/pages/GruposEmpresasPage.tsx`: `ModeloFormPage` e `AbaVaga` (formulário compartilhado entre vaga e modelo; também `cargaDoHorario`, `modosDoModelo`, `textoPrevisto`).
- `frontend/src/pages/ProcessosPage.tsx`: `ProcessosRelacionados`, usado na ficha.
- `frontend/src/components/busca-opcao.tsx` (`BuscaOpcao`), `paginacao.tsx`, `pagina.tsx` (`CabecalhoPagina`, `CampoFiltro`, `ResumoResultados`).
- `frontend/src/lib/format.ts` (`STATUS_VAGA`, `situacaoLabel`, `regimeLabel`, `diasEmAberto`, `money`, `textoPlano`) e `frontend/src/lib/horario-escala.ts` (cópia da versão do backend).

**Backend**
- `backend/src/routes/index.ts`: vagas (linhas 229-273), modelos globais (232-253), modelos legados `/api/v1/modelos` (718-726), cargos (757), abertura de vaga `/grupos-empresas/vagas` (762-770), sync manual (592-597).
- `backend/src/services/vaga.service.ts`: list, get (ficha + mensagem), update (status no Lightsail + espelhos), create e sugeridos.
- `backend/src/repositories/vaga.repository.ts`: SQL de `dna_work.vaga` (lista, ficha, funil, inscritos, sugeridos, quem já trabalhou, opções de filtro).
- `backend/src/services/presenters.ts`: `presentVaga`, `posicoesLivres`.
- `backend/src/services/cadastro.service.ts`: `consultarModelos`, `opcoesModelos`, `obterModelo`, `criarModelo`, `editarModelo`, `apagarModelo`, `listarModelos`, `criarVaga`. Também tem `MIRROR_SQL`, que cria `public.vaga`, `public.vaga_repetida` e `public.cargo` se não existirem.
- `backend/src/services/legado.service.ts`: `modelos` e `modelo` (`dna_work.vaga_modelo`, modelos antigos).
- `backend/src/services/cargo.service.ts` e `backend/src/lib/cargo.ts`: lista de cargos, `chaveCargo`, `nomePadronizado`.
- `backend/src/schemas/vaga.ts` (`vagaCreateSchema`, `vagaPatchSchema`, `vagaListSchema`) e `backend/src/schemas/cadastro.ts` (`modeloVagaSchema`, `vagaCadastroSchema`, `regrasDaVaga`).
- `backend/src/lib/vaga-status.ts`: conversão dos códigos do Lightsail para os 4 status.
- `backend/src/lib/vaga-id.ts`: `assinaturaDaVaga` e `reagruparVagaIds`.
- `backend/src/lib/mensagem-vaga.ts`: `mensagemDaVaga` (mensagem no formato do Notion).
- `backend/src/lib/horario-escala.ts`: `DIAS_ESCALA`, `textoDoHorario`, `diasPorEscala`, `diasDoTexto`.
- Syncs: `backend/src/services/sync-ciclo.service.ts`, `vagas-abertas-sync.service.ts`, `cargos-sync.service.ts`, `notion-sync.service.ts`, `backend/src/lib/triagem-notion.ts` (leitura do Notion) e `backend/src/lib/agenda-sync.ts` (slots de 6 h).
- `backend/src/services/triagem.service.ts:68`: `horarioDoEspelho`, que lê o horário de `public.vaga` (ver "Dados").

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/vagas?page&pageSize&cargo_chave&grupo_id&id_empresa&tipo_vaga&situacao&q&cargo` | Lista paginada (`meta.total`). | routes:255 → `VagaService.list` → `VagaRepository.list` |
| GET | `/api/v1/vagas/filtros` | Empresas que têm vaga (com grupo), grupos e cargos (grafias juntadas por chave). | routes:254 → `VagaRepository.opcoesFiltro` |
| GET | `/api/v1/modalidades` | `dna_work.modalidade_vaga`. | routes:148 |
| GET | `/api/v1/vagas/:id` | Ficha: dados, funil, benefícios e `mensagem`. | routes:259 → `VagaService.get` |
| PATCH | `/api/v1/vagas/:id` | Edita a vaga ou só a `situacao`. | routes:262 → `VagaService.update` |
| POST | `/api/v1/vagas` | Cria a vaga só em `dna_work.vaga`. Nenhuma tela usa: `/vagas/nova` redireciona. | routes:229 → `VagaService.create` |
| GET | `/api/v1/vagas/:id/sugeridos` | Candidatos sugeridos e quem já trabalhou. | routes:265 → `VagaRepository.sugeridos` |
| GET | `/api/v1/vagas/:id/contratacoes` | Contratações da vaga. | routes:268 → `ContratacaoService.listByVaga` |
| GET | `/api/v1/vagas/modelos?cargo&tipo` | Consulta os modelos globais (`tipo`: estagio, clt ou pj). | routes:232 → `CadastroService.consultarModelos` |
| GET | `/api/v1/vagas/modelos/opcoes` | Cargos que já têm modelo, para as sugestões. | routes:241 → `CadastroService.opcoesModelos` |
| GET | `/api/v1/vagas/modelos/:vagaId` | Um modelo, no formato do formulário. | routes:242 → `CadastroService.obterModelo` |
| POST | `/api/v1/vagas/modelos` | Cria o modelo. | routes:245 → `CadastroService.criarModelo` |
| PUT | `/api/v1/vagas/modelos/:vagaId` | Edita o modelo. | routes:248 → `CadastroService.editarModelo` |
| DELETE | `/api/v1/vagas/modelos/:vagaId` | Apaga o modelo. As vagas já abertas não mudam. | routes:251 → `CadastroService.apagarModelo` |
| GET | `/api/v1/cargos` | Lista de `public.cargo` para o campo Cargo. | routes:757 → `CargoService.listar` |
| GET | `/api/v1/grupos-empresas/vagas` | Modelos para o campo "Modelo" da abertura de vaga. | routes:762 → `CadastroService.listarModelos` |
| POST | `/api/v1/grupos-empresas/vagas` | Abre a vaga (Lightsail + Postgres). Fica na tela de Grupos e Empresas. | routes:768 → `CadastroService.criarVaga` |
| GET | `/api/v1/modelos/:id` | Modelo legado (`dna_work.vaga_modelo`). `VagaFormPage` chama com `?modelo=`, mas só quando não há `:id`, o que nunca acontece na rota atual. | routes:722 → `LegadoService.modelo` |
| GET | `/api/v1/empresas?pageSize=100` e `/api/v1/empresas/:id` | Opções de empresa no `VagaFormPage`. | routes:194/198 |
| POST | `/api/v1/configuracoes/sync?dry=` | Roda o ciclo de sync na hora (só administrador). | routes:592 → `SyncCicloService.executar` |

## Dados

**Postgres `dna_work.*` (cópia do Lightsail): base de `/vagas` e da ficha**
- `dna_work.vaga`:
  - campos principais: `id_vaga`, `id_empresa`, `cargo`, `tipo_vaga`, `salario` (texto no formato legado), `status` (código 0-9), `comparador`, `dataabertura`, `quantidade_posicoes`, `codigo`;
  - horário: `texto_carga`, `horabase`, `hora_saida_base`, `segunda_entrada` … `domindo_saida` (assim mesmo, "domindo"), `semanas_inicio`, `semanas_fim`, `periodo`, `tempo_refeicao`;
  - outros: `beneficios_texto`, `sexo`, `idade`, `idadeate`, `km`, `atribuicaoes`, `atribu_contrato`, `requisitos_desejaveis`, `destaque`, `obs`.
- `dna_work.empresa`, `dna_work.modalidade_vaga`, `dna_work.conratacaovaga` (ocupadas = contratações com status `CONTRATACAO_STATUS_ATIVO`), `dna_work.vaga_endereco` e `dna_work.beneficio_vaga` / `dna_work.beneficio`.
- Funil e inscritos: `dna_work.chamado_emtrevista`, `emcaminhamento`, `selecionado_vaga`, `candidatura`, `candidatos_incluidos_vaga`. Cada uma só é usada se existir.
- Sugeridos: `dna_work.candidato`, `cargos_candidato`, `exp_proficional`, `flex`.
- `dna_work.vaga_modelo` (modelos legados).

**Postgres `public.*`**
- `public.vaga`: **só as vagas abertas** das empresas cadastradas no sistema novo. `id` é o `id_vaga` do Lightsail.
  - Campos: `vaga_id` (grupo de vagas repetidas), `grupo_id`, `empresa_id`, `tipo_vaga` (1 estágio, 2 CLT), `cargo`, `cargo_id`, `descricao`, `requisitos`, `salario` (numeric), `carga_horaria`, `sexo`, `idade`, `idade_ate`, `km`, `atividades`, `horario`, `beneficios`, `tipo_trabalho`, `cep`, `latitude`, `longitude`, entre outros (DDL em `cadastro.service.ts`, `MIRROR_SQL`).
  - Quem lê: Triagem e Dossiê.
- `public.vaga_repetida`: modelos globais. Aqui `vaga_id = id`, e `tipo_vaga` é **texto** ("1" estágio, "2" CLT, "4" PJ).
- `public.cargo` (`nome`, `chave` única, `descricao`, `requisitos`), `public.empresa` (`grupo_id`, `nome_fantasia`, `local`, `cep`, `latitude`, `longitude`) e `public.grupo`.

**Formato de `public.vaga.horario` (o "espelho")**
- Gerado por `horarioDe` (vagas-abertas-sync.service.ts:108), usado também no `criarVaga` e no `VagaService.update`:
  `periodo;início-fim;tempo_refeicao;1=HH:MM-HH:MM;2=…;…;7=…;texto=<texto_carga>`
- A numeração é a do Lightsail: 1 = domingo, 2 = segunda … 7 = sábado. `início-fim` vem de `faixaDaSemana` (ex.: `2-6`, segunda a sexta; `2-1`, segunda a domingo). Dia sem horário fica `N=`. Dentro da faixa, um dia sem hora usa `horabase`/`hora_saida_base`.
- Leitura: `horarioDoEspelho` (triagem.service.ts:68) usa o `texto=` quando existe; senão monta o texto pela grade com `textoDoHorario` ("Segunda a sexta, 08:00 às 17:00; sábado por escala, 08:00 às 14:00").
- Os modelos (`vaga_repetida.horario`) guardam o texto de `textoDoModelo`. A consulta de modelos sempre remonta o texto pelos dias, porque o valor guardado pode estar no formato do sync.

**MySQL Lightsail**
- `PATCH /vagas/:id` com mudança de situação: `UPDATE vaga SET status = ?, data_adicao = data_adicao` (vaga.service.ts:55). Sem MySQL, devolve 503 `LIGHTSAIL_INDISPONIVEL`.
- `criarVaga` (abertura, na tela de Grupos e Empresas) grava `codigo_vaga`, `vaga`, `etapa_vaga`, `log_diversos`, `vaga_valores` e `vaga_endereco`, e repete tudo em `dna_work.*` e `public.vaga`.

**Syncs que alimentam `public.vaga`** (ciclo em `SyncCicloService`, um por vez)
1. **vagas-abertas** (`VagasAbertasSyncService.executar`, linha 178):
   - lê do Lightsail as vagas com `empresa.sede = 10`, `vaga.status = 0` e `tipo_vaga IN (1,2,4)`;
   - insere em `public.vaga` as que faltam, se a empresa já está em `public.empresa`; as outras viram "pendentes";
   - alinha horário, turno, idade, salário e benefícios das que já existem (referência: `dna_work.vaga`);
   - **apaga** de `public.vaga` as que mudaram para status diferente de 0 no Lightsail;
   - no fim, `reagruparVagaIds`.
2. **cargos** (`CargosSyncService.executar`, linha 89): para `public.vaga` e `public.vaga_repetida`, cria em `public.cargo` (vazios) os cargos que faltam, liga `cargo_id` e completa `descricao`/`requisitos` vazios com os do cargo.
3. **notion** (`NotionSyncService`):
   - lê blocos/tabelas do Notion (`NOTION_TOKEN`, API `2022-06-28`) e, para vagas abertas cujo `codigo` segue o padrão `ABC-123`, grava os turnos do Notion no Lightsail (`UPDATE vaga … WHERE status = 0`), em `dna_work.vaga` e em `public.vaga.horario`;
   - grava bairro/cidade/UF da empresa no Lightsail (`empresa`) e em `public.empresa.local`;
   - não mexe nos modelos.
- **Agenda**: `agendarPorSlot` roda o ciclo nos slots 00/06/12/18 h de São Paulo. Fica ativo quando `NOTION_SYNC_AUTO=true` ou, sem essa variável, em `NODE_ENV=production` (server.ts:18). O modo dry vem de `NOTION_SYNC_DRY`. O disparo manual é `POST /api/v1/configuracoes/sync`.

## Regras e comportamentos importantes

- **Situação** (`lib/vaga-status.ts`):
  - os códigos do Lightsail viram 4 status: aberta = 0, 3, 4, 5, 9; pausada = 8; contratada = 1; fechada = 2, 6, 7 (código desconhecido ou nulo conta como fechada);
  - ao mudar de status, grava o código padrão (aberta 0, pausada 8, contratada 1, fechada 6). Se o status não mudou, mantém o código atual (`codigoParaStatus`).
- **Mudança de status**: grava **primeiro no Lightsail** e depois em `dna_work.vaga`. Se o Lightsail falhar, nada muda (vaga.service.ts:51-56, 92-98). A lista pede confirmação ("Mudar X de A para B?"); a ficha usa `window.confirm` para Fechar/Reabrir.
- **Outras edições** (cargo, salário, horário, benefícios…): vão para `dna_work.vaga` e `public.vaga`. **O Lightsail não recebe** (comentário em vaga.service.ts:99).
  - Mudar algum campo de horário recalcula `semanas_inicio`/`semanas_fim` e a grade do espelho (`horarioAlinhado` mantém o texto antigo quando só muda emoji para "?").
  - Benefícios vão para `dna_work.vaga.beneficios_texto` e `public.vaga.beneficios`.
  - No fim, `reagruparVagaIds` roda; se falhar, o sync recalcula depois.
- **Quantidade**: não pode ficar abaixo das posições ocupadas (409 `QUANTIDADE_INSUFICIENTE`). Vaga sem quantidade conta como 1 posição livre (`posicoesLivres`). Patch vazio dá 400 `NADA_PARA_ATUALIZAR`.
- **Modalidade**: precisa existir em `dna_work.modalidade_vaga` (422 `MODALIDADE_INVALIDA`).
- **Migration**: listar, ver e editar exigem a coluna `quantidade_posicoes` (`ensureCapacityColumn`). Sem ela, erro de migration, e a lista mostra o aviso da linha 94.
- **Lista**: ordenada por `dataabertura desc`. Vagas "teste…" com status bloqueado vão para o fim. O filtro de cargo por `cargo_chave` pega todas as grafias do mesmo cargo. Trocar de grupo limpa a empresa que é de outro grupo.
- **Tempo em aberto**: só para vagas abertas; âmbar a partir de 30 dias, vermelho a partir de 60.
- **`vaga_id`** (`lib/vaga-id.ts`): vagas em `public.vaga` com **mesma empresa e todos os campos de `CAMPOS_ASSINATURA` iguais** dividem o mesmo `vaga_id`. Cada grupo fica com o `vaga_id` que a maioria já tinha, para mudar o mínimo possível os ids já enviados a candidatos. A Triagem mostra só uma vaga por `vaga_id`.
- **Modelos**:
  - um por cargo (comparado por `chaveCargo`) e modalidade; repetido dá 409 `MODELO_JA_EXISTE`;
  - o cargo vem da lista (`cargo_id`) **ou** é novo (`novo_cargo` com nome, descrição e requisitos). Ter os dois ou nenhum é erro;
  - estágio usa carga 20 ou 30, CLT usa 40 ou 44; `idade_ate` não pode ser menor que `idade`; idades entre 14 e 80; `km` é sempre 30;
  - a carga é sugerida pelo horário: CLT ≥ 42 h → 44, senão 40; estágio ≥ 25 h → 30, senão 20 (GruposEmpresasPage.tsx:431-432);
  - apagar remove só o modelo.
- **Sugeridos** (`VagaRepository.sugeridos`):
  - exclui colaboradores e quem tem contratação ativa;
  - filtra pela distância (`km` da vaga) quando há coordenadas, senão pela cidade;
  - estágio: modalidade do curso e término do estudo no futuro;
  - CLT: cargo no objetivo, nos cargos ou nas experiências, mais sexo e idade.
- **Permissão** (lib/paginas.ts): `/api/v1/vagas*` e `/api/v1/modalidades` aceitam `vagas`, `vagas-modelos` ou `vagas-modelo`; `/api/v1/cargos` aceita também `empresas`; `/api/v1/modelos` aceita `vagas-modelos` ou `vagas-modelo`. Já `/api/v1/grupos-empresas/*` exige `empresas`, então o link "Abrir vaga" dos modelos e o botão "Nova vaga" levam a uma tela que pede a página `empresas`.

## Cuidados ao mudar

- **Três bancos para a mesma vaga**: Lightsail (fonte), `dna_work.vaga` (cópia, base da lista e da ficha) e `public.vaga` (só abertas, base da Triagem). Mudar uma coluna num lugar sem o sync ou o `update` correspondente deixa as telas divergentes.
- O sync **apaga** de `public.vaga` toda vaga que não está com status 0 no Lightsail. Fechar uma vaga em `/vagas` tira ela da Triagem no próximo ciclo, não na hora.
- `horarioDe`, `faixaDaSemana` e `horarioAlinhado` (vagas-abertas-sync) são usados por `VagaService` e `CadastroService`. `horarioDoEspelho` (triagem.service) é usado por Triagem, matching JEV e Dossiê. Não mude o formato `N=HH:MM-HH:MM;texto=` sem mudar os dois lados.
- `textoDoHorario` existe no backend e no frontend (`lib/horario-escala.ts`): as duas cópias precisam gerar o mesmo texto (comentário no topo do arquivo). O texto é cortado em 255 caracteres (`texto_carga` tem limite de 255 no schema).
- As colunas do Lightsail se chamam `domindo_entrada`/`domindo_saida`. O formulário de modelo e o de abertura usam `domingo_*`, e o de edição usa `domindo_*`.
- `public.vaga_repetida.tipo_vaga` é texto e `public.vaga.tipo_vaga` é inteiro.
- `AbaVaga` é compartilhado entre a abertura de vaga (tela de Grupos e Empresas) e o formulário de modelo: mexer nele afeta as duas telas.
- `reagruparVagaIds` lê `public.vaga` inteira e atualiza linha a linha. Incluir um campo em `CAMPOS_ASSINATURA` muda o agrupamento de todas as vagas.
- `ProcessosRelacionados` vem de `ProcessosPage.tsx`: mudar a assinatura dele quebra a ficha da vaga.

## Como testar

- `/vagas`: aplique cada filtro e confira a URL e o total. Mude a situação pelo selo numa vaga de teste (isso grava no Lightsail).
- `/vagas/:id`: confira a mensagem e o "Copiar mensagem", os sugeridos e os contratados. Use Fechar/Reabrir só numa vaga de teste.
- `/vagas/:id/editar`: mude o horário (Fixo/Escala/Folga), use "Gerar texto pelos dias", salve e confira o `public.vaga.horario` da vaga, se ela estiver aberta.
- `/vagas/modelos`: crie um modelo, tente criar outro com o mesmo cargo e modalidade (deve dar 409), edite, use "Abrir vaga" e apague.
- Sync: `POST /api/v1/configuracoes/sync?dry=1` (administrador) mostra o que seria feito sem gravar.
- Testes do backend: `backend/test/vaga-consulta.test.ts` (status, posições, unidades, cargos), `vaga-id.test.ts`, `mensagem-vaga.test.ts`, `horario-escala.test.ts`, `cargo.test.ts` e `triagem.test.ts` (horário e Notion).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
