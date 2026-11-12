# Agente — Triagem

> Última revisão: 2026-11-12 (empresa sem CNPJ)

## Para que serve

O operador informa o CEP da pessoa e o sistema lista as vagas abertas (CLT e/ou estágio) dentro de um raio, da mais próxima para a mais distante. Ele marca as vagas que combinam e copia um texto pronto para mandar à pessoa. Na **busca inteligente**, o currículo é lido pela IA (Luna, via OpenAI) e cada vaga recebe um score de compatibilidade do **JEV** (TypeSafe). Na aba **Gerador de dossiês**, o operador busca o candidato no CRM pelo telefone, escolhe a vaga, envia o currículo e a IA escreve o dossiê para a empresa. Se o operador pedir, o dossiê é salvo como nota no negócio do CRM.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/triagem` | `TriagemPage` | `frontend/src/pages/TriagemPage.tsx` | Menu "Pesquisar vagas + CEP". Formulário (CEP, tipo CLT/Estágio, raio de 5 a 50 km, sexo aceito, idade), aviso de empresas pendentes, lista de vagas em cartões, painel "Texto para a pessoa". Com "Busca inteligente" ligada, aparecem o perfil do candidato (`PerfilCandidato`) e a análise JEV em cada cartão (`AnaliseDaVaga`). |
| `/triagem/dossie` | `DossiePage` | `frontend/src/pages/DossiePage.tsx` | Menu "Gerador de dossiês". Quatro passos: candidato no CRM (telefone), vaga escolhida, currículo, conferir dados. À direita, o dossiê gerado, que pode ser editado, copiado e salvo como nota no CRM. |

O menu fica em `frontend/src/components/shell.tsx` (`triagemLinks`, linhas 16-19). As duas abas usam o mesmo id de página, `triagem`. Quando o usuário não tem a página `painel`, o grupo Triagem aparece no topo do menu (shell.tsx:188).

## Arquivos

**Frontend**
- `frontend/src/pages/TriagemPage.tsx`: página da busca. Os componentes `AvisoEmpresasPendentes`, `AvisoCep`, `CartaoVaga`, `Chip`, `ComoFunciona` e `Secao` ficam no próprio arquivo.
- `frontend/src/components/triagem-inteligente.tsx`: `useStatusIa`, `PerfilCandidato` (upload do currículo, escolaridade, turnos, tempo de experiência, habilidades) e `AnaliseDaVaga` (score, nível, confiança, explicação).
- `frontend/src/lib/triagem-matching.ts`: regras puras da tela. `organizarVagas` (avaliadas / sem avaliação / pendentes), `ordemDeExibicao`, `proximoLote`, `idsParaRepetir`, `selecaoValida`, `problemaDoPerfil`, `perfilPreenchido`, `rotuloTurnos`, `rotuloScore` e `textoParaCandidato`, que monta o texto com emojis (reexportado pela `TriagemPage`).
- `frontend/src/lib/triagem-geo.ts`: geocodifica o CEP **no navegador**. Usa ViaCEP para o endereço e, para a coordenada, tenta AwesomeAPI, depois BrasilAPI e por fim Photon (komoot).
- `frontend/src/pages/DossiePage.tsx`: página do dossiê. Tudo fica no arquivo (`Passo`, `Indicador`, `ResumoCandidato`).
- `frontend/src/lib/foto-cargo.ts`: `fotoDoCargo` (nome do cargo → `/cargos/<chave>.jpg`, ou null) e `copiarComFoto` (texto + foto num único item da área de transferência). Também usado pela ficha da vaga.
- `frontend/public/cargos/*.jpg`: fotos ilustrativas por cargo (1024 px, JPEG, nome = `chaveCargo` com hífens).
- `frontend/src/lib/api.ts`: `api()` com cookie (`credentials: "include"`) e envelope `{ success, data, meta }`.

**Backend**
- `backend/src/routes/index.ts`, linhas 772-879: todas as rotas `/api/v1/triagem/*`.
- `backend/src/services/triagem.service.ts`: busca geográfica (`buscar`), `empresasPendentes`, `horarioDoEspelho`, `semHomeOffice` e `localDaEmpresa`. As três últimas também são usadas pelo matching e pelo dossiê.
- `backend/src/services/triagem-matching.service.ts`: compatibilidade pelo JEV (`avaliar`, `estadoJev`).
- `backend/src/services/curriculo.service.ts`: análise do currículo pela Luna (OpenAI Responses API).
- `backend/src/services/dossie.service.ts`: vagas, candidato (CRM + `candidatos_dados`), geração do dossiê e nota no CRM.
- `backend/src/lib/jev/jev.ts`: contrato do JEV (`PERGUNTA_COMPATIBILIDADE`, `montarEstadoJev`, `interpretarRespostaJev`, `criarTransporteJev`).
- `backend/src/lib/jev/explicacao.ts`: comparação de termos feita pelo DNA Work, que não entra no score.
- `backend/src/lib/curriculo/arquivo.ts` (`prepararCurriculo`: valida o tipo pelos bytes, limite de 5 MB, DOCX vira texto), `perfil.ts` (schema JSON da Luna, normalização, `perfilSuficiente`, `textoDoCurriculo`) e `cep.ts` (`cepDoCurriculo`: CEP escrito no currículo ou procurado no ViaCEP pelo endereço).
- `backend/src/lib/dossie/prompts.ts`: `PROMPT_DOSSIE_CLT` e `PROMPT_DOSSIE_ESTAGIO`, copiados do workflow "gerador-dossies" do n8n.
- `backend/src/lib/triagem-geo.ts`: `distanciaKm` (haversine), `geocodeCepServidor` (AwesomeAPI e depois Google Geocoding) e `rotuloDoCep` (ViaCEP).
- `backend/src/lib/horario-escala.ts`: `DIAS_ESCALA` e `textoDoHorario`, usados por `horarioDoEspelho`.
- `backend/src/origem/crm-dna.ts`: `crmRequest` (CRM DNA).
- `backend/src/lib/paginas.ts`: regra `/api/v1/triagem` → página `triagem`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| POST | `/api/v1/triagem/vagas` | Busca rápida: vagas no raio, filtradas por tipo, sexo e idade. | routes/index.ts:772 → `TriagemService.buscar` |
| GET | `/api/v1/triagem/empresas-pendentes` | Empresas do agente com vaga aberta no Lightsail que ainda não estão em `public.empresa`. | routes/index.ts:786 → `TriagemService.empresasPendentes` |
| GET | `/api/v1/triagem/ia/status` | Diz se a Luna está configurada (o modelo só é conferido na OpenAI com `?verificar=1`) e o estado do JEV (pronto, motivo, escala, lote). | routes/index.ts:789 |
| POST | `/api/v1/triagem/curriculo` | Envia o currículo (arquivo base64 **ou** texto) para a Luna e recebe o perfil e o CEP. Limite de 8 MB no corpo, 20 req/min. | routes/index.ts:799 → `prepararCurriculo` + `CurriculoService.analisar` |
| POST | `/api/v1/triagem/compatibilidade` | Score do JEV para até 30 vagas (`vagaIds`), 30 req/min. | routes/index.ts:814 → `TriagemMatchingService.avaliar` |
| GET | `/api/v1/triagem/dossie/vagas` | Lista as vagas abertas para o select. | routes/index.ts:836 → `DossieService.listarVagas` |
| GET | `/api/v1/triagem/dossie/status` | Diz se a IA está configurada e qual é o modelo. | routes/index.ts:837 |
| GET | `/api/v1/triagem/dossie/candidato?telefone=&dealId=` | Negócios do CRM pelo telefone (ou pelo id) mais os dados do candidato. Exige telefone ou dealId. | routes/index.ts:838 → `DossieService.buscarCandidato` |
| POST | `/api/v1/triagem/dossie` | Gera o dossiê (vagaId, dealId, telefone, manual, arquivo **ou** texto). | routes/index.ts:848 → `DossieService.gerar` |
| POST | `/api/v1/triagem/dossie/nota` | Grava o dossiê como nota no negócio do CRM. | routes/index.ts:873 → `DossieService.salvarNota` |

## Dados

**Postgres**
- `public.vaga`: o que a busca lê (`id`, `vaga_id`, `tipo_vaga` (1 = Estágio, 2 = CLT), `cargo`, `salario`, `beneficios`, `sexo`, `idade`, `idade_ate`, `horario`, `tipo_trabalho`, `latitude`, `longitude`, `empresa_id`). O matching e o dossiê leem também `atividades`, `descricao`, `requisitos`, `escolaridade` e `carga_horaria`. Só entram vagas com latitude e longitude preenchidas (triagem.service.ts:115). Segundo dossie.service.ts:327, "public.vaga só guarda as abertas; o sync tira as fechadas".
- `public.empresa`: `nome_fantasia`, `local`, `id` e `cnpj`. Para achar as empresas pendentes, a empresa do Lightsail conta como cadastrada se o `id_empresa` estiver em `public.empresa.id` ou se o CNPJ (quando tem) bater. Empresa sem CNPJ só é reconhecida pelo id.
- `public.cargo`: `descricao` e `requisitos` servem de reserva quando a vaga não tem descrição nem requisitos (matching e dossiê).
- `dna_work.flex`: `id_flex` → `valor`, que traduz o código de escolaridade da vaga antes de mandar ao JEV.
- `public.candidatos_dados`: lida pelo dossiê, nunca gravada aqui. Campos: `dealId`, `telefone`, `resumo_cv`, `nome`, `idade`, `escolaridade`, `turno`, `sexo`, `"teste comportamental"`, `info_conducoes`, `resumo_entrevista`, `id_vaga_escolhida`, `id_empresa`, entre outros. A consulta fica em `SQL_CANDIDATO` (dossie.service.ts:74).

**MySQL Lightsail (legado)**
- `empresa` + `vaga`: em `empresasPendentes`, empresas com `sede = 10` e `vaga.status = 0`. Sem conexão MySQL, a lista volta vazia.

**Serviços externos**
- **OpenAI (Responses API)**: análise do currículo (Luna) e geração do dossiê. Variáveis `OPENAI_API_KEY`, `OPENAI_API_URL`, `LUNA_MODEL` e `LUNA_TIMEOUT_MS`. As chamadas usam `store: false`.
- **JEV (TypeSafe)**: `POST {JEV_API_URL}/v1/systemone`. Variáveis `JEV_API_URL`, `JEV_API_KEY`, `JEV_MODEL`, `JEV_TIMEOUT_MS`, `JEV_CONCORRENCIA` (paralelismo) e `JEV_LOTE` (vagas por lote na tela, padrão 10).
- **CRM DNA**: `GET /api/deals?search=<telefone>&perPage=10`, `GET /api/deals/:id` (inclui `dealPanelFields`) e `POST /api/deals/:id/notes`. Variáveis `CRM_DNA_API_URL`/`CRM_BASE_URL` e `CRM_DNA_API_TOKEN`/`CRM_API_KEY` (lidas em `origem/crm-dna.ts`).
- **Geocodificação**: no navegador, ViaCEP, AwesomeAPI, BrasilAPI e Photon. No servidor, quando a tela não manda lat/lng, AwesomeAPI e depois Google (`GOOGLE_MAPS_API_KEY`). O rótulo da origem vem do ViaCEP. Para o CEP do currículo, ViaCEP por endereço.
- **n8n**: não é chamado. A lógica copia os workflows "gerador-dossies", "enviar vagas automaticas" (nó Jev) e "resumo cv + match".

**Gravações**: a busca, o currículo e a compatibilidade não gravam nada (comentário em routes/index.ts:788). A única escrita da seção é a nota no CRM (`/dossie/nota`).

## Regras e comportamentos importantes

- **Filtros da busca** (triagem.service.ts:136-165):
  - distância em linha reta menor ou igual a `raioKm` (1 a 100, padrão 10; a tela oferece 5/10/15/20/30/50);
  - sexo: só exclui quando a vaga tem sexo definido diferente de `I` e diferente do pedido;
  - idade: compara com `idade` e `idade_ate` da vaga, quando são inteiros maiores que zero.
- **Vagas repetidas**: vagas com o mesmo `vaga_id` aparecem uma vez só, a unidade mais próxima (triagem.service.ts:167-170).
- **Home office** (`tipo_trabalho = "remoto"`): ganha linha própria e o trecho "home office" sai do horário (`semHomeOffice`).
- **Salário**: zero ou vazio vira "salário a combinar". `beneficios` preenchido acrescenta "+ benefícios" ao texto.
- **Horário do espelho** (`horarioDoEspelho`, triagem.service.ts:68): se `horario` tem `texto=…`, usa esse texto. Senão, monta a grade a partir de `1=HH:MM-HH:MM;2=…` (1 = domingo … 7 = sábado) com `textoDoHorario`.
- **Geocodificação**: o navegador manda lat/lng. Se não conseguir, o servidor tenta. Sem ponto, a resposta é 422 `CEP_NAO_LOCALIZADO`.
- **Busca inteligente**:
  - exige currículo com pelo menos 30 caracteres ou habilidades com pelo menos 3, e o turno de estudo quando a escolaridade é `cursando_medio` (front: `problemaDoPerfil`; back: refine no zod e `perfilSuficiente`);
  - depois da busca, a tela analisa o primeiro lote (`JEV_LOTE`) e o resto fica em "Ainda não analisadas", com o botão "Analisar mais N";
  - a busca rápida nunca chama IA nem JEV.
- **Status da avaliação**: `avaliada`, `indisponivel` (JEV sem configuração), `dados_insuficientes` (vaga sem atividades, descrição e requisitos, ou perfil fraco), `falhou` (timeout ou erro; pode ser repetida), `resposta_invalida` e `nao_encontrada`.
- **Score do JEV**: vai de 0 a 4 (cinco níveis) e **não é percentual**. As avaliadas são ordenadas pela posição na escala; no empate, pela distância. A explicação textual é do DNA Work e não é o motivo do score (`AVISO_EXPLICACAO`).
- **Seleção**: guardada por id. Reordenar não desmarca, e as vagas que saem do resultado deixam de contar (`selecaoValida`). O texto copiado segue a ordem da tela.
- **Foto do cargo**: com **uma única** vaga marcada e foto para o cargo (`fotoDoCargo(vaga.title)`), a foto aparece acima do texto e o botão vira "Copiar foto e texto". Ele grava **um único item** na área de transferência com `text/plain` e `image/png` (o JPEG é redesenhado em PNG num canvas, porque o navegador só aceita PNG). Com duas ou mais vagas, ou cargo sem foto, copia só o texto. Se o navegador recusar a imagem, também cai para o texto.
  - As mensagens são enviadas pelo chat do CRM próprio. Até 2026-11-12, ao colar, o CRM ficava só com a imagem e descartava o `text/plain`. A correção (usar o texto colado como legenda da imagem) foi pedida a quem cuida do CRM. Não troque por dois botões: o formato de um item com os dois tipos é o que o CRM vai ler.
- **Currículo**:
  - PDF, DOCX, PNG, JPG e WEBP até 5 MB; `.doc` é recusado. O tipo é detectado pelos bytes, não pela extensão;
  - a Luna não extrai idade, sexo, telefone nem e-mail;
  - se o modelo não aceitar structured output (HTTP 400), a chamada é repetida pedindo o JSON no texto;
  - o CEP do currículo preenche o campo só se estiver vazio; se o operador já digitou outro, a tela oferece "Usar este CEP".
- **Dossiê**:
  - dados do candidato: `candidatos_dados` do negócio mais as linhas do mesmo telefone, com e sem o 55, juntadas campo a campo, completadas pelos `dealPanelFields` do CRM. `id_vaga_escolhida` do CRM sempre ganha do banco (dossie.service.ts:137);
  - a vaga do `id_vaga_escolhida` (pelo `id` ou pelo `vaga_id`) já vem selecionada;
  - campos manuais preenchidos ganham dos dados do banco;
  - texto colado ou DOCX vira `resumo_cv`; PDF e imagem vão anexados e substituem o `resumo_cv` do banco;
  - telefone, CEP e ids não entram no prompt (`FORA_DO_PROMPT`);
  - vaga de estágio (`tipo_vaga = 1`) usa o prompt de estágio; as demais, o de CLT;
  - sem nome dá 422 `SEM_NOME`; sem currículo dá 422 `SEM_CURRICULO`; resposta `ERRO_DADOS_INCONSISTENTES` da IA dá 422 `DADOS_INCONSISTENTES`;
  - o botão "Salvar como nota no CRM" só aparece quando há `dealId`.
- **Permissão**: todas as rotas `/api/v1/triagem/*` exigem login e a página `triagem` (app.ts onRequest + lib/paginas.ts). O administrador passa direto.
- **Limites por minuto**: currículo 20, compatibilidade 30, busca de candidato no dossiê 60, gerar dossiê 20, nota 20.

## Cuidados ao mudar

- `horarioDoEspelho`, `localDaEmpresa` e `semHomeOffice` são exportados de `triagem.service.ts` e usados por `triagem-matching.service.ts` e `dossie.service.ts`. Mudar o formato de `public.vaga.horario` (gravado pelos syncs e pelo cadastro de vaga) afeta as três telas.
- O contrato de `POST /triagem/vagas` (`{ originLabel, jobs: [{ id, title, company, location, contractType, salaryLabel, hasBenefits, homeOffice, schedule, schedules, distanceKm }] }`) é coberto por `triagem-rotas.test.ts`. Não renomeie campos.
- `textoParaCandidato` define a mensagem que vai ao candidato (emojis, numeração, fechamento). Ela é testada em `frontend/test/triagem-matching.test.ts`.
- As regras de perfil suficiente existem em dois lugares: `perfilPreenchido` no front e `perfilSuficiente` no back. Mudou um, mude o outro.
- Foto nova de cargo: salve em `frontend/public/cargos/<chave-com-hifens>.jpg` e acrescente a chave em `FOTOS` (`lib/foto-cargo.ts`). Nomes diferentes para a mesma função (ex.: Estagiário Marketing → Assistente de Marketing) ficam em `MESMA_FOTO`.
- Os prompts do dossiê são cópias do n8n. Ao mudar o texto no n8n, atualize `lib/dossie/prompts.ts`.
- O matching e o dossiê têm consulta "básica" para quando faltam colunas (`descricao`, `requisitos`) ou a tabela `cargo` (erros 42703/42P01). Não remova essa reserva sem garantir o schema.
- Nunca registre em log o conteúdo do currículo nem do estado mandado ao JEV. Os comentários e as mensagens de erro foram feitos para não expor esses dados.
- Os nomes de variável do CRM aparecem de dois jeitos: a mensagem de erro do dossiê cita `CRM_BASE_URL`/`CRM_API_KEY`, e o código aceita também `CRM_DNA_API_URL`/`CRM_DNA_API_TOKEN`.

## Como testar

- Abra `/triagem`, digite um CEP e clique em "Buscar vagas". Marque vagas e confira o texto e o botão "Copiar texto". Com uma só vaga marcada (ex.: Operador de Caixa), confira a foto e o "Copiar foto e texto"; no Windows, a área de transferência deve ter imagem e texto (`[System.Windows.Forms.Clipboard]::GetImage()` e `ContainsText()`).
- Ligue "Busca inteligente", envie um PDF de currículo e confira o CEP preenchido, os campos do perfil e as seções "Avaliadas pelo JEV", "Sem avaliação" e "Ainda não analisadas". Sem `JEV_API_URL`/`JEV_API_KEY`, aparece o aviso "Score JEV indisponível".
- Abra `/triagem/dossie`, busque um telefone, escolha a vaga, envie o currículo e gere o dossiê. Só use "Salvar como nota no CRM" com um negócio de teste.
- Testes do backend: `backend/test/triagem.test.ts` (horário, distância, Notion), `triagem-inteligente.test.ts` (arquivo, currículo, JEV), `triagem-rotas.test.ts` (permissão, contrato, 503 sem chave) e `dossie.test.ts`.
- Teste do frontend: `frontend/test/triagem-matching.test.ts`.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm test -w frontend`.
