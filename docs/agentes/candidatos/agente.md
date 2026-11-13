# Agente — Candidatos

> Última revisão: 2026-11-13 (botão "Abertura de conta" na ficha)

## Para que serve

Consultar, cadastrar e editar as pessoas (candidatos) da base. A lista mostra contato, formação, situação de contratação e quem cadastrou (DNA Work ou outra empresa). A ficha junta dados pessoais, atendimento, currículo, vagas sugeridas, contratações, processos seletivos e documentos, e permite criar o acesso do candidato ao LMS de cursos.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/candidatos` | `CandidatosPage` | `frontend/src/pages/CandidatosPage.tsx` | Lista paginada (20 por página) com filtros nome, CPF, telefone e "Mais filtros" (e-mail, cidade, UF, contratação, regime, cadastrado por). Tabela em tela larga, cartões em tela estreita. Passar o mouse numa linha abre um preview flutuante (busca a ficha). |
| `/candidatos/novo` | `CandidatoFormPage` | `frontend/src/pages/CandidatoFormPage.tsx` | Formulário de cadastro em blocos (`Card` com título e frase, grade de 6 colunas): Identificação (cadastrado por, empresa, nome, CPF, e-mail, nascimento, telefones), Endereço, Estudos e trabalho, Dados bancários, Observações. Rodapé fixo (`sticky`) com o erro, "Cancelar" e "Cadastrar candidato" / "Salvar alterações". |
| `/candidatos/:id` | `CandidatoDetailPage` | `frontend/src/pages/CandidatoDetailPage.tsx` | Ficha: `CabecalhoPagina` (nome, idade · CPF, selos "Candidato DNA"/"Cadastrado por <empresa>" e "Captado pela DNAWORK"; botões "Abertura de conta" (`AberturaConta`), "Novo processo" (`/processos/novo?candidato=:id`) e "Editar"); card "Contato e cadastro" (`dl` com e-mail, telefone, endereço, nascimento, origem do currículo, última atualização) ao lado do card "Acesso aos cursos" (LMS); `FichaCandidato` (destaques objetivo/último cargo/entrevistas, currículo do atendimento, formação, perfil comportamental, conhecimentos em selos, dados do atendimento, experiência); vagas sugeridas e histórico de contratações lado a lado; processos seletivos; documentos. |
| `/candidatos/:id/editar` | `CandidatoFormPage` | `frontend/src/pages/CandidatoFormPage.tsx` | Mesmo formulário, preenchido; envia só os campos alterados. |

Não há abas: cada rota é uma tela.

## Arquivos

Frontend
- `frontend/src/pages/CandidatosPage.tsx` — lista; exporta também `idadeDe()`.
- `frontend/src/pages/CandidatoFormPage.tsx` — criar/editar.
- `frontend/src/pages/CandidatoDetailPage.tsx` — ficha + componente interno `AcessoCursos` (LMS).
- `frontend/src/components/ficha-candidato.tsx` — `FichaCandidato` (também usado em `ProcessoDetailPage`).
- `frontend/src/components/documentos-candidato.tsx` — `DocumentosCandidato`.
- `frontend/src/components/abertura-conta.tsx` — `AberturaConta`: botão e janela da carta "Abertura de conta" (campos editáveis, gera o PDF); `lerValor` lê "1.234,56".
- `ProcessosRelacionados` exportado de `frontend/src/pages/ProcessosPage.tsx` (também usado em `VagaDetailPage`).
- `frontend/src/components/preview.tsx`, `paginacao.tsx`, `pagina.tsx`, `ui.tsx`; `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts`.
- Menu: `frontend/src/components/shell.tsx` (item `candidatos`; `/candidatos` → página `candidatos`).

Backend
- Rotas: `backend/src/routes/index.ts` (linhas ~156–189) e a rota do LMS registrada à parte em `backend/src/app.ts` (~170–192).
- Service: `backend/src/services/candidato.service.ts` (`CandidatoService`, `fichaDoCandidato`).
- Repository: `backend/src/repositories/candidato.repository.ts`, `backend/src/repositories/candidato-documento.repository.ts`.
- Contratações do candidato: `backend/src/services/contratacao.service.ts` (`listByCandidato`) + `backend/src/repositories/contratacao.repository.ts`.
- Schemas: `backend/src/schemas/candidato.ts`, `backend/src/schemas/common.ts` (CPF, telefone, e-mail, UF).
- Apresentação: `backend/src/services/presenters.ts` (`presentCandidato`).
- LMS: `backend/src/lib/lms-acesso.ts` (`criarAcessoLms`).
- Carta "Abertura de conta": `backend/src/lib/abertura-conta.ts` (`sugestaoAberturaConta`, `aberturaContaSchema`, `linhasAberturaConta`, `buildAberturaContaPdf` com pdf-lib, `valorPorExtenso`, `dataDaCarta`).
- Permissão por página: `backend/src/lib/paginas.ts` + hook `onRequest` em `backend/src/app.ts`.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/candidatos` | Lista paginada com filtros (`nome`, `cpf`, `email`, `telefone`, `cidade`, `uf`, `id_empresa`, `regime`, `situacao`, `vinculo`, `cadastro_de`, `cadastro_ate`, `sort`, `order`) | `routes/index.ts:159` → `CandidatoService.list` → `CandidatoRepository.list` |
| GET | `/api/v1/candidatos/:id` | Ficha completa (com atendimento e currículo) | `routes/index.ts:163` → `fichaDoCandidato` |
| POST | `/api/v1/candidatos` | Cria candidato (201) | `routes/index.ts:156` → `CandidatoService.create` |
| PATCH | `/api/v1/candidatos/:id` | Atualiza campos permitidos | `routes/index.ts:166` → `CandidatoService.update` |
| GET | `/api/v1/candidatos/:id/contratacoes` | Histórico de contratações (paginado) | `routes/index.ts:184` → `ContratacaoService.listByCandidato` |
| GET | `/api/v1/candidatos/:id/documentos` | Documentos do candidato | `routes/index.ts:169` → `listarDocumentos` |
| GET | `/api/v1/candidatos/:id/documentos/:documento/arquivo` | Baixa/abre o arquivo do documento (inline, `no-store`) | `routes/index.ts:172` → `arquivoDoDocumento` |
| GET | `/api/v1/candidatos/:id/abertura-conta` | Sugestão para a carta: nome, CPF, endereço e telefone da ficha; bolsa (`vaga.salario`) e empresa (CNPJ, razão social e, entre parênteses, a fantasia) da contratação ativa ou, sem ela, da mais recente; `contratacao` = `ativa`/`recente`/`nenhuma`. 404 se o candidato não existe | `routes/index.ts` → `sugestaoAberturaConta` |
| POST | `/api/v1/candidatos/:id/abertura-conta` | Gera o PDF da carta com os campos conferidos (`aberturaContaSchema`: data, nome, cpf, endereco, telefone, bolsa, cnpj, empresa). Não grava nada | `routes/index.ts` → `buildAberturaContaPdf` |
| POST | `/api/v1/candidatos/:id/acesso-lms` | Cria/reaproveita o aluno no LMS | `app.ts:170` → `criarAcessoLms` |
| GET | `/api/v1/processos?page=1&pageSize=20&id_candidato=:id` | Processos seletivos do candidato (via `ProcessosRelacionados`) | rota de processos (fora desta seção) |
| GET | `/api/v1/empresas?pageSize=20&q=...` | Busca de empresa no formulário quando "Outra empresa" | `routes/index.ts:194` (ver agente de Empresas) |

## Dados

Postgres (schema `dna_work`, cópia do Lightsail):
- `dna_work.candidato` — lido e gravado. Campos principais: `id_candidato` (UUID gerado no create), `nome`, `cpf`, `email` (gravado em minúsculas), `celular`, `telefonefixo`, `datanascimento`/`datacadastro`/`ultimaalteracao` (formato legado, convertido por `isoToLegacy`/`legacyToIso`), endereço, `escola`/`nome_escola`/`curso`/`modalidadecurso`/`semestre`, bancários (`banco`, `agencia`, `numero_conta`, `chave_pix`…), `id_empresa` (preenchido = candidato de outra empresa), `atendimento` (JSON), `colaborador` (insert grava 0), `data_adicao` (ordenação padrão).
- `dna_work.empresa` — só leitura (nome da empresa do vínculo; checagem de existência).
- `dna_work.conratacaovaga` (sic), `dna_work.vaga`, `dna_work.modalidade_vaga` — leitura para situação/regime de contratação e histórico.
- `dna_work.processo_seletivo` — leitura do `atendimento` para completar a ficha.
- Currículo (leitura, só se a coluna existir — checado em `information_schema`): `dna_work.flex`, `instituicao`, `instituicao_convenio`, `exp_proficional`, `con_candidato`, `conhecimentos`, `resultado_disc`, `emcaminhamento`, `vaga`, `empresa`.

Postgres (schema `public`):
- `public.candidato_documentos` — só leitura aqui (quem grava é o gerador de TCE, `gravarDocumentosDoTce`). Um registro por (`id_candidato`, `tipo`); tipos `cpf`, `rg`, `nascimento`, `endereco`, `matricula`, `responsavel`; `arquivo` (bytea), `arquivo_nome`, `arquivo_tipo`, `origem`, `tce_id`.

Lightsail MySQL: não é acessado por esta seção (grava só no Postgres `dna_work`).

Serviço externo — LMS de cursos:
- `POST {LMS_API_URL}/api/integracao/acessos` com `Authorization: Bearer {LMS_ACCESS_TOKEN}` e corpo `{ name, email, password?, resetPassword? }`, timeout 20 s.
- Variáveis: `LMS_ACCESS_TOKEN` (sem ele → 503 `LMS_INDISPONIVEL`), `LMS_API_URL` (padrão `https://cursos.dnawork.ai`).
- Se o host público devolver 502 com "Service is not reachable", tenta de novo num host direto fixo no código (`LMS_DIRETO` em `lib/lms-acesso.ts:6`).
- Nada do LMS é gravado no banco; a senha não é salva.

Variáveis de config que mudam a lista: `CONTRATACAO_STATUS_ATIVO` (padrão 1) e `CONTRATACAO_STATUS_ENCERRADO` (padrão 2), passadas ao `CandidatoRepository` em `app.ts:118`.

## Regras e comportamentos importantes

- **Cadastro (novo candidato):** só nome e CPF são obrigatórios também no servidor — o e-mail ficou opcional em `candidatoCreateSchema` (antes o cadastro sem e-mail era recusado com mensagem genérica e "não avançava"); grava e-mail vazio quando não vem. Mensagens de nome, CPF, e-mail e UF em português. Em "Cadastrado por: Outra empresa", a busca mostra cada empresa com CNPJ, razão social e cidade (e tudo no `title` ao passar o mouse), para separar unidades com o mesmo nome (ex.: Lumi); escolhida, a lista fecha e aparece a empresa com o CNPJ e "Trocar".
- **Pesquisar sempre tem efeito:** com os mesmos filtros, recarrega a lista (`refetch`, ou a chave `rodada` no Financeiro); o botão mostra "Pesquisando…" com ícone girando enquanto carrega. Todo botão do sistema afunda e muda o tom ao ser pressionado (`index.css`, `.app-canvas button:active`).
- **CPF único**: create e update recusam CPF já usado por outro candidato (comparando só dígitos) → 409 `CPF_DUPLICADO` com `details.id_candidato` (`candidato.service.ts:51`, `:75`). O CPF é validado e normalizado para dígitos por `cpfSchema` (`schemas/common.ts:8`).
- **E-mail obrigatório só no create** do backend (`candidatoCreateSchema` usa `z.string().email()`), mas o formulário do frontend aceita e-mail vazio — salvar candidato novo sem e-mail volta erro de validação da API.
- **Campos editáveis**: só os da lista `PATCHABLE` (`candidato.service.ts:38`). Sem nenhum campo → 400 `NADA_PARA_ATUALIZAR`. Todo update grava `ultimaalteracao = hoje`.
- **Vínculo com empresa**: `id_empresa` preenchido = "Outra empresa"; vazio = "Candidato DNA". Se informado, a empresa precisa existir em `dna_work.empresa` → senão 422 `EMPRESA_NAO_ENCONTRADA`. No formulário, o seletor "Cadastro" exige escolher a empresa quando "Outra empresa".
- **Formulário de edição** envia só o que mudou (`diferencas`), mas sempre inclui `id_empresa` (valor ou `null`); por isso o aviso local "Nenhum campo foi alterado" do frontend na prática não dispara, e salvar sem mudanças regrava `id_empresa` e `ultimaalteracao`.
- **Filtro "Contratação"** (`situacao`): `ativo` = tem contratação com status ativo; `encerrado` = tem encerrada e nenhuma ativa; `sem_vinculo` = nenhuma contratação (`candidato.repository.ts:185–195`). **Regime** filtra só contratações ativas pela modalidade da vaga.
- **Coluna "Contratação" da lista**: para cada candidato da página, a contratação ativa ou, sem ela, a mais recente (`contratosDaLista`). Se as tabelas/colunas não existirem (erros 42P01/42703), devolve vazio em vez de falhar.
- **Ficha / atendimento**: os campos `resumo_cv`, `teste_comportamental`, `escolaridade`, `idade`, `tipo_de_vaga`, `captado_por` que faltarem no atendimento do candidato são completados pelo processo seletivo mais recente que os tiver (`candidato.service.ts:9–36`). "Captado pela DNAWORK" aparece quando `atendimento.captado_por === "dnawork"`.
- **Vagas sugeridas**: até 8 vagas com `status` 0 na mesma cidade da empresa (ILIKE) e, se houver, mesma escolaridade (`modalidadecurso`), mais recentes primeiro (`candidato.repository.ts:299`).
- **Dados bancários e atendimento** só saem no detalhe (`presentCandidato(row, true)`), não na lista.
- **Acesso LMS** (`AcessoCursos` + `lib/lms-acesso.ts`): exige nome e e-mail com "@" na ficha (422 `NOME_AUSENTE`/`EMAIL_AUSENTE`); senha opcional, mínimo 8 (422 `SENHA_CURTA`; o botão fica desabilitado no frontend); checkbox "trocar a senha" manda `resetPassword: true`. O mesmo e-mail não gera outra conta. A senha só volta se o LMS a definiu nessa chamada; ela não fica salva. Erros do LMS são traduzidos sem repassar o corpo: 401 → 502 `LMS_CREDENCIAL`, 404 → 502 `LMS_SEM_ROTA`, 422 → 422 `LMS_RECUSOU`, 503 → 503, outros → 502. O schema da rota aceita `trails`, mas ele é ignorado.
- **Abertura de conta** (carta para o banco abrir a conta da bolsa auxílio, no modelo em papel: data por extenso, "REF. SOLICITAÇÃO DE ABERTURA DE CONTA PARA CRÉDITO DE BOLSA AUXÍLIO", nome, CPF, endereço, telefone, bolsa com valor por extenso, CNPJ e empresa, linha "ASS." para o carimbo e a assinatura da empresa):
  - a janela abre com a sugestão do GET e tudo é editável; a data vem como hoje;
  - nome, empresa e bolsa maior que zero são obrigatórios (front e `aberturaContaSchema`);
  - nome, endereço e empresa saem em maiúsculas; CPF, CNPJ e telefone são formatados quando têm o número certo de dígitos; campo vazio sai "—";
  - nada é gravado: nem a carta nem os campos editados.
- **Permissão**: todas as rotas `/api/v1/candidatos*` (inclusive `acesso-lms`) exigem a página `candidatos` ou admin (`lib/paginas.ts:32`). A seção "Processos seletivos" da ficha chama `/api/v1/processos`, que exige a página `processos`.

## Cuidados ao mudar

- `fichaDoCandidato` é usada também por `backend/src/services/processo.service.ts:68` (ficha do processo; `ProcessoDetailPage` usa `FichaCandidato`); mudar o formato quebra as duas telas.
- `ProcessosRelacionados` e `FichaCandidato` são compartilhados com Vagas e Processos. `FichaCandidato` devolve um fragmento (vários `Card`/`dl` irmãos): o pai precisa ser um `grid gap-5`.
- Nomes de empresa que vêm com entidade HTML (`&amp;`) passam por `textoPlano` na ficha; no formulário de edição os campos mostram o valor como está gravado (decodificar mudaria o que é salvo).
- `CandidatoRepository` recebe os códigos de status de contratação por config; não fixe `1`/`2` no SQL.
- As consultas de currículo dependem de colunas que podem não existir na cópia (`colunas()` em `information_schema`); mantenha a checagem ao adicionar campos.
- Nomes de tabela/coluna legados com erro de digitação são reais: `conratacaovaga`, `exp_proficional`, `id_canditado`, `id_instiduicao`, `id_intituicao`, `emcaminhamento`. Não "corrija".
- Datas do candidato estão em formato legado no banco; sempre converter com `lib/dates.ts`.
- A rota `acesso-lms` está em `app.ts`, não em `routes/index.ts` — procure nos dois lugares.
- O PATCH monta `SET` com os nomes das chaves; só é seguro porque o service filtra por `PATCHABLE`. Não remova esse filtro.
- O endpoint de arquivo do documento é aberto direto por `<a href>` (cookie de sessão); manter `Content-Disposition: inline` e `Cache-Control: private, no-store`.

## Como testar

- Manual: abrir `/candidatos`, filtrar por nome/CPF/telefone e pelos "Mais filtros"; passar o mouse numa linha (preview); abrir uma ficha; criar candidato em `/candidatos/novo` (testar CPF repetido → mensagem de duplicado); editar e conferir que só o alterado é enviado; em "Outra empresa", pesquisar empresa com 2+ letras. Na ficha, "Criar acesso no LMS" só funciona com `LMS_ACCESS_TOKEN` configurado — não use com e-mail real em ambiente de teste sem querer criar a conta.
- Testes backend:
  - `backend/test/escopo.test.ts` (Postgres embutido): "cadastra candidato e bloqueia CPF duplicado", "pesquisa candidatos e empresas com filtro e paginação".
  - `backend/test/abertura-conta.test.ts`: valor por extenso, data, linhas da carta, schema e geração do PDF.
  - `backend/test/lms-acesso.test.ts`: token ausente, corpo enviado, senha devolvida, fallback de host, tradução de erros, senha curta.
  - Não encontrado teste para `/candidatos/:id/documentos`, para a ficha (`fichaDoCandidato`) nem para vagas sugeridas.
- Frontend: não há teste específico desta seção (só `frontend/test/triagem-matching.test.ts`).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`.
