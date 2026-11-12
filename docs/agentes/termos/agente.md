# Agente — Termos e documentos

> Última revisão: 2026-11-12 (commit "Preenche o TCE pela vaga de estágio e fixa a carga horária")

## Para que serve

Gera o Termo de Compromisso de Estágio (TCE) em PDF a partir de um formulário (pré-preenchido por candidato, contratação, empresa e escola), deixa conferir, editar, excluir e enviar para assinatura na ZapSign, com e-mails pela Mailjet. A aba "Gerar documento" monta, sem gravar nada, o contrato de prestação de serviços (Modelo 1, .docx), o termo de adesão (Modelo 2, .docx) e a rescisão de estágio do ensino médio (PDF).

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/termos` (menu "Consultar") | `TermosPage` | `frontend/src/pages/TermosPage.tsx` | Lista de TCEs (até 200, mais novos primeiro) com filtro por status (Todos, Gerado, Aguardando, Assinado, Recusado), botões copiar link de assinatura por signatário, editar e excluir. |
| `/termos/gerar` (menu "Gerar TCE") | `GerarTcePage` → `GeradorTce` | `frontend/src/pages/TermosPage.tsx`, `frontend/src/components/gerador-tce.tsx` | Formulário do TCE em cinco blocos numerados na ordem do termo (empresa concedente, estagiário, responsável legal opcional, instituição de ensino, condições do estágio/Anexo I), cada um com a pesquisa de preenchimento automático no topo (empresa, candidato, escola e vaga de estágio). Painel lateral fixo com os campos principais preenchidos por bloco e o botão de gerar. Aceita `?contratacao=<id>` (botão "Gerar TCE" da ficha de contratação). |
| `/termos/documentos` (menu "Gerar documento") | `GerarDocumentoPage` (+ `GerarRescisaoMedio`) | `frontend/src/pages/GerarDocumentoPage.tsx`, `frontend/src/components/gerar-rescisao-medio.tsx` | Seletor de documento: Contrato (Modelo 1), Termo de adesão (Modelo 2) ou Rescisão estágio ensino médio. Baixa o arquivo gerado. |
| `/termos/:id/editar` | `EditarTcePage` → `GeradorTce editarId` | `frontend/src/pages/TermosPage.tsx` | Mesmo formulário carregado com os dados salvos; salvar refaz o PDF. |
| `/termos/:id` | `TermoDetailPage` | `frontend/src/pages/TermoDetailPage.tsx` | Status "gerado": prévia do PDF (iframe) + "Pedir assinatura da escola", "Enviar PDF por e-mail", "Enviar para assinatura". Depois de enviado: signatários com copiar/abrir link, "Baixar PDF assinado", "Reenviar e-mails de assinatura". |

Ids de permissão: `termos`, `termos-gerar`, `termos-documento` (`frontend/src/components/shell.tsx:30-34`, `:69-71`).

## Arquivos

Frontend
- `frontend/src/pages/TermosPage.tsx` (`TermosPage`, `GerarTcePage`, `EditarTcePage`)
- `frontend/src/pages/TermoDetailPage.tsx`
- `frontend/src/pages/GerarDocumentoPage.tsx`
- `frontend/src/components/gerador-tce.tsx` (formulário do TCE, validação de datas no cliente)
- `frontend/src/components/gerar-rescisao-medio.tsx`
- `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts`

Backend
- Rotas: `backend/src/routes/index.ts:323-458` (`/termos`, `/tce`), `:881-886` (webhook ZapSign), `:892-904` (`guardarDocumentosDoTceCom`)
- Services: `backend/src/services/tce.service.ts`, `backend/src/services/termo.service.ts`
- Libs: `backend/src/lib/tce-pdf.ts` (preenche `templates/tce.pdf`), `tce-fields.ts` (lista de campos, apólice fixa, campos de data), `tce-candidato.ts` (pré-preenchimento e término do estágio), `escolas.ts`, `empresas-cadastro.ts`, `email-modelo.ts`, `mailjet.ts`, `zapsign.ts`, `documento-contrato.ts` (docx), `rescisao-medio-pdf.ts` (PDF com pdf-lib)
- Schemas: `backend/src/schemas/documento-contrato.ts` (`documentoSchema`, união por `modelo`)
- Repositório: `backend/src/repositories/candidato-documento.repository.ts` (`candidatoDoTce`, `gravarDocumentosDoTce`)
- Modelos de arquivo: `templates/tce.pdf` (raiz do repo; `tce-pdf.ts` procura em `./templates` e `../templates`), `backend/templates/modelo-1-contrato.docx`, `backend/templates/modelo-2-aderente.docx`
- Migrations: `prisma/migrations/20261022120000_termo_estagio`, `20261022140000_tce`, `20261109120000_candidato_documentos`

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/termos?status=` | Lista TCEs (limite 200) | `routes/index.ts:323` → `TermoService.list` |
| GET | `/api/v1/termos/:id` | Detalhe (id UUID) | `:351` → `TermoService.get` |
| DELETE | `/api/v1/termos/:id` | Apaga TCE, payload e arquivo PDF | `:354` → `TceService.excluir` |
| GET | `/api/v1/tce/empresas` | Todas as empresas de `public.empresa` (filtro no cliente, 15 itens) | `:360` → `listEmpresasCadastro` |
| GET | `/api/v1/tce/escolas?q=` | Busca instituições (≥2 caracteres, máx. 15) | `:361` → `searchEscolas` |
| GET | `/api/v1/tce/vagas?q=` | Vagas de estágio abertas (`public.vaga`, `tipo_vaga = 1`) por cargo ou empresa (máx. 30), com os campos do Anexo I que cada uma preenche | `routes/index.ts` → `TceService.buscarVagasEstagio` → `vagaParaTce` (`lib/tce-candidato.ts`) |
| GET | `/api/v1/tce/candidatos?q=` | Busca candidato por nome, CPF ou empresa (máx. 20) | `:364` → `TceService.buscarCandidatos` |
| GET | `/api/v1/tce/candidatos/:id` | Pré-preenchimento a partir do candidato (e da contratação mais recente/ativa dele) | `:367` → `candidatoParaTce` |
| GET | `/api/v1/tce/contratacoes/:id` | Pré-preenchimento a partir de uma contratação | `:370` → `contratacaoParaTce` |
| POST | `/api/v1/tce/gerar` | Gera PDF, grava `public.tces` e `dna_work.termo_estagio`, grava documentos do candidato | `:373` → `TceService.gerar` |
| GET | `/api/v1/tce/:id/dados` | Dados salvos para edição | `:406` → `TceService.dados` |
| PATCH | `/api/v1/tce/:id` | Salva edição, refaz PDF, volta status para `gerado` | `:409` → `TceService.atualizar` |
| GET | `/api/v1/tce/:id/pdf` | PDF do TCE (inline) | `:441` → `TceService.lerPdf` |
| POST | `/api/v1/tce/:id/enviar` | Cria documento na ZapSign e envia e-mails de assinatura | `:447` → `TceService.enviar` |
| POST | `/api/v1/tce/:id/email` | Manda o PDF anexo para estagiário, empresa e escola | `:450` → `enviarDocumento` |
| POST | `/api/v1/tce/:id/email-assinatura` | Reenvia e-mails com link de assinatura | `:453` → `enviarAssinaturas` |
| POST | `/api/v1/tce/:id/email-escola` | Pede assinatura (manual) à escola, cópia para documentos@ | `:456` → `enviarAssinaturaEscola` |
| POST | `/api/v1/termos/documentos` | Gera e devolve o arquivo (docx ou PDF) para download | `:332` → `gerarDocumento` / `buildRescisaoMedioPdf` |
| GET | `/api/v1/termos/rescisao-medio?q=` | Busca estagiários de ensino médio (máx. 20) | `:326` → `TermoService.estagiariosMedio` |
| GET | `/api/v1/termos/rescisao-medio/:id` | Dados de uma contratação para preencher a rescisão | `:329` → `TermoService.estagiarioMedio` |
| GET | `/api/v1/empresas?pageSize=8&q=` | Busca de empresa em "Gerar documento" | ver agente de Empresas |
| POST | `/api/v1/zapsign/webhook` | Público. Atualiza `termo_estagio` pelo `token` | `:881` → `TermoService.receberWebhook` |

## Dados

Postgres:
- `dna_work.termo_estagio` (lida/gravada): `id` (UUID, igual ao `public.tces.id`), `id_contratacao` (opcional), `nome` ("TCE - <nome>"), `status` (`gerado`, `enviado`, `assinado`, `recusado`, `cancelado`), `zapsign_token`, `arquivo_assinado`, `signatarios` (jsonb: nome, email, status, url), `tce_id`, `candidato_nome`, `empresa_nome`, `criado_em`, `atualizado_em`. As colunas `id_candidato`/`id_empresa` existem mas não são preenchidas pelo gerador.
- `public.tces` (lida/gravada): `id`, `empresa_id`, `empresa_nome`, `candidato_nome`, `payload` (jsonb `{ campos, empresa }` — é a fonte da edição e do envio), `pdf_path` (nome do arquivo), `status` (sempre `generated`, não é usado na tela).
- `public.candidato_documentos` (gravada): upsert por `(id_candidato, tipo)` com tipos `cpf`, `rg`, `nascimento`, `endereco`, `matricula`, `responsavel`, `origem = 'tce'`, `tce_id`.
- `public.empresa` (lida): empresas do gerador (`lib/empresas-cadastro.ts`).
- `public.vaga` (lida): vagas de estágio abertas para a pesquisa do bloco 5 (`cargo`, `salario`, `beneficios`, `horario`, `jornada`, `atividades`, `empresa_id`).
- Somente leitura em `dna_work`: `candidato`, `conratacaovaga`, `empresa`, `vaga`, `instituicao`, `flex` (nível do curso), `rescisao_documento` (motivo/avaliação/resumo para a rescisão do médio), `emailsvinculo`, `emails`, `servidor_email` (modelos de e-mail).
- Arquivos: PDFs do TCE em disco, pasta `PDF_STORAGE_DIR`; sem ela, `./data/tces` ou, se não for gravável, a pasta temporária do sistema (`tce.service.ts:483-497`).

Serviços externos:
- **ZapSign** (`ZAPSIGN_API_URL`, `ZAPSIGN_API_TOKEN`). No TCE não usa `user_token`/pasta (diferente da rescisão).
- **Mailjet** (`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_FROM`, `MAILJET_FROM_NAME`). Modelos usados por descrição em `dna_work.emailsvinculo`: "Assinatura Digital Candidato", "Assinatura Digital Responsável Candidato", "Assinatura Digital Empresa", "Assinatura Digital Instituição de Ensino", "Assinatura manual instituição". Remetente vem de `servidor_email.remetente_jetmail` ou `MAILJET_FROM`.

"Gerar documento" (contrato, adesão, rescisão do médio) **não grava nada** no banco.

## Regras e comportamentos importantes

TCE (`tce.service.ts`):
- Carga horária é fixa: 6 horas por dia e 30 por semana (`CARGA_HORARIA_DIARIA`/`CARGA_HORARIA_SEMANAL` em `lib/tce-fields.ts`, repetidas em `FIXOS` no `gerador-tce.tsx`). Os campos são só leitura na tela; o backend sobrescreve ao gerar/salvar e o pré-preenchimento por candidato/contratação também usa esses valores.
- Pesquisa de vaga (bloco 5): ao escolher, preenche `jornada` (texto do horário da vaga, senão `vaga.jornada`), `bolsa` (salário em R$, se maior que zero), `beneficios` e `plano_atividades` (`vaga.atividades`); só os que a vaga tem. Se a empresa concedente ainda não foi escolhida, preenche com a empresa da vaga (mesmo id de `public.empresa`); se já houver outra, só avisa que a vaga é de outra empresa.
- Apólice de seguro é fixa (`APOLICE_SEGURO` em `lib/tce-fields.ts`, repetida como `APOLICE` em `gerador-tce.tsx`); o campo é somente leitura e o backend sempre sobrescreve.
- Só os campos de `MANUAL_FIELDS` são aceitos; o resto do corpo é ignorado (`routes/index.ts:395` e `:431`).
- Validações no servidor (`montar`, `:218-259`): nome obrigatório (422 `NOME_OBRIGATORIO`), razão social da concedente obrigatória (422 `EMPRESA_OBRIGATORIA`), término ≥ início, no máximo 730 dias (422 `ESTAGIO_MAIS_DE_2_ANOS`), datas válidas em `AAAA-MM-DD` (gravadas no PDF como `DD/MM/AAAA`).
- No cliente (`gerador-tce.tsx:94-104`) há a mesma trava de 2 anos e mais uma: o término não passa do término dos estudos do candidato (`terminoEstudo`), que **só é checada no frontend**.
- Para gerar, `empresa_id` (UUID de `public.empresa`) é obrigatório; o botão fica desabilitado sem empresa escolhida. Na edição, a empresa é opcional.
- O frontend não envia `escola_id`; os dados da escola vão preenchidos nos `campos` (escolha na busca copia `escola.campos`).
- Signatários (`signatariosDe`, `:510-522`): estagiário; responsável (se `email_responsavel` diferente do do estagiário); empresa (representante ou razão social); escola (se tiver e-mail).
- Enviar (`enviar`, `:315-366`): só com status `gerado` (409 `TERMO_JA_ENVIADO`); estagiário e empresa precisam de e-mail (422 `EMAIL_AUSENTE`); status vira `enviado` e guarda token e links. Se a Mailjet não estiver configurada, o envio à ZapSign vale e a resposta traz `email_enviado: false`; outro erro de e-mail vira 502 `EMAIL_ASSINATURA` (o TCE já ficou enviado).
- Editar: bloqueado se `assinado` (GET dados) ou `assinado`/`cancelado` (PATCH) → 409 `TERMO_BLOQUEADO`. Salvar refaz o PDF no mesmo arquivo, zera `zapsign_token` e volta para `gerado` — o documento antigo na ZapSign não é cancelado (não encontrado código para isso).
- Excluir: apaga `public.tces`, `dna_work.termo_estagio` (transação) e o PDF. Não cancela nada na ZapSign.
- Webhook (`termo.service.ts:32-40, 77-92`): `refus` → `recusado`; `cancel`/`delet` → `cancelado`; `signed` ou todos assinados → `assinado`; senão `enviado`. Guarda `signed_file` em `arquivo_assinado`.
- Documentos do candidato (`routes/index.ts:892-904`): candidato escolhido na tela → o da contratação → o do mesmo CPF. Falha só vai para o log; o TCE é salvo mesmo assim.
- Termos antigos sem linha em `public.tces` não têm PDF nem dados para editar (mensagens 404 específicas).
- Pré-preenchimento (`lib/tce-candidato.ts`): término = fim da contratação limitado ao término dos estudos e a 2 anos do início; sem contratação, usa o término dos estudos. Escola vem de `candidato.escola` → `instituicao`; se só houver o nome, usa a busca e aceita apenas se achar uma única.

Gerar documento:
- Validações só no cliente (`GerarDocumentoPage.tsx:191-217`): razão social, CNPJ com 14 dígitos, endereço, e-mail; no contrato, taxas conforme modalidade (direta/estágio/ambas), ao menos um regime; na adesão, contratante signatária, responsável, cargo, faturamento. O backend valida o formato com `documentoSchema`.
- Contrato/adesão: preenche o XML do .docx modelo; se o modelo não tiver os trechos esperados → 500 `MODELO_DIVERGENTE`.
- Rescisão ensino médio: busca contratações com `vaga.tipo_vaga = 1` e nível médio (`flex.valor` com "médio" ou `vaga.escolaridade = '31'`); ativos primeiro. Exige nome, razão social, datas, atividades, motivo e avaliação (cliente).
- Os dados de cada parte (contrato x adesão) ficam guardados ao trocar o seletor (`useRef`), mas somem ao sair da página.

## Cuidados ao mudar

- `public.tces.payload` é a única fonte para editar, enviar e mandar e-mail. Mudar o formato quebra termos já gerados.
- `MANUAL_FIELDS` (backend), `CAMPOS` (frontend) e os campos do `templates/tce.pdf` precisam andar juntos.
- PDFs ficam em disco local. Se `PDF_STORAGE_DIR` não apontar para volume persistente, o PDF some ao reiniciar o container e "Enviar"/"PDF" dão 404.
- O webhook ZapSign é o mesmo das rescisões de contratação (`ContratacaoService.receberAssinatura`).
- `GerarTcePage` é aberta pela ficha de contratação (`/termos/gerar?contratacao=`); não mude o nome do parâmetro sem ajustar `ContratacaoDetailPage.tsx`.
- `/api/v1/tce/*` exige `termos` ou `termos-gerar`; `/api/v1/termos/*` aceita também `termos-documento`. "Gerar documento" chama `/api/v1/empresas`, que exige a página `empresas` (`backend/src/lib/paginas.ts`).
- Os nomes dos modelos de e-mail são buscados por texto exato em `emailsvinculo.descricao`; renomear na tela de E-mails quebra o envio (404 `MODELO_NAO_ENCONTRADO`).
- Os textos dos avisos citam remetentes fixos ("documentos@dnawork.ai", "contratos@dnawork.ai") no frontend; o remetente real vem do banco/variável.
- O filtro da lista não tem botão para `cancelado`, e a coluna "Enviado" mostra `criado_em`.

## Como testar

- Tela: `/termos/gerar` → escolher empresa, buscar candidato e escola, escolher a vaga no bloco 5 (confere jornada, bolsa, benefícios, plano e, sem empresa escolhida, a concedente), conferir carga horária 6/30 só leitura, gerar; conferir o PDF em `/termos/:id`; editar em `/termos/:id/editar`; excluir em `/termos`. Abrir uma contratação de estágio e clicar "Gerar TCE" para testar o pré-preenchimento. Em `/termos/documentos`, gerar contrato, adesão e rescisão do médio e abrir os arquivos. Envio real só com ZapSign/Mailjet configurados.
- Testes: `backend/test/tce-candidato.test.ts` (pré-preenchimento, término do estágio, carga horária fixa e vaga → campos do Anexo I), `backend/test/documento-contrato.test.ts` (contrato e adesão .docx), `backend/test/rescisao-medio.test.ts` (cláusulas e PDF da rescisão do médio). Não há teste para gerar/enviar TCE nem para o webhook (não encontrado).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm run agentes:conferir`.
