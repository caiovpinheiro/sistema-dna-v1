# Agente — Financeiro

> Última revisão: 2026-11-13 (commit "Corrige faturamento Todas, nomes com &amp;, rescisão pela ficha e cadastro de instituição")

## Para que serve

É onde o financeiro fecha o mês. Em Faturamento, calcula quanto cada empresa deve no mês e envia o relatório com o boleto do Asaas. Em Contas a receber, acompanha e mexe nas cobranças do Asaas: cria cobrança avulsa, dá baixa, exclui e emite nota fiscal. A Régua de cobrança mostra as etapas de cobrança de cada fatura. O Relatório Procfy lista as faturas do sistema antigo e exporta para Excel. O Holerite conta quantos candidatos ativos cada empresa tem no mês.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/financeiro/faturamento` | `GerarFaturamentoPage` | `frontend/src/pages/FinanceiroPage.tsx` | Título "Gerar faturamento" com "Gerar boletos do mês" no cabeçalho (pede confirmação). Cartões "Valor a receber no mês" (calculado) e "Em aberto no Asaas". Filtros com rótulo (empresa, mês por nome, ano, situação da fatura) e "Pesquisar"; abaixo, o total de empresas e "Limpar filtros" (volta ao mês atual e a "Aberta e parcial"). Tabela "Matrizes sem candidatos" (só aparece quando há matriz). "Selecionar todas (N)", contador de selecionadas e "Enviar relatório e boleto" (só com seleção), barra de progresso e aviso. Tabela de empresas: seleção, empresa (fantasia e razão social), CNPJ, tipo, fechamento ("Dia 10"), itens, a faturar, situação em selo, relatório enviado e "Relatório"; rodapé com o total a receber e a paginação. |
| `/financeiro/contas-a-receber` | `ContasReceberPage` | `frontend/src/pages/ContasReceberPage.tsx` | Bloco "Nova cobrança" com pesquisa de empresa (a mesma pesquisa filtra a tabela), valor, vencimento, forma de pagamento, descrição e "Gerar cobrança" no fim do bloco. Filtros com rótulo (vencimento de/até e situação), total de cobranças e "Limpar filtros" (volta ao mês atual e limpa a empresa). "Selecionar todas a pagar sem envio" e "Enviar relatório e boleto". Tabela de cobranças do Asaas (empresa com CNPJ, descrição, vencimento, valor, situação em selo, relatório por e-mail) com as ações Relatório, Link, Enviar relatório, Verificar, Baixar, Nota, PDF da nota e Excluir (rosa, por último); rodapé com o total em aberto da lista. Modais "Data do recebimento" ("Confirmar recebimento") e "Emitir nota fiscal". |
| `/financeiro/regua` | `ReguaCobrancaPage` | `frontend/src/pages/ReguaCobrancaPage.tsx` | Cabeçalho com competência (AAAA-MM) e "Simular o dia"; "Como a régua funciona" recolhível; resumo do mês (total devido, grupos, pendências, pagos); filtro por situação (Todos, Em aberto, Comprovante a validar, Encaminhados, Pagos) e busca por empresa/filial/CNPJ, feitos na tela; uma linha por grupo (matriz com as filiais) que abre as faturas. Em cada fatura: valor, vencimento, situação, próximo passo e comprovante, links do Asaas, Registrar/Validar comprovante, "Ver candidatos da fatura" e a tabela de etapas com selo de situação e a próxima etapa destacada, com as ações Registrar envio, Escalar, Encaminhar e Enviar relatório. A simulação aparece numa tabela (etapa, e-mail, empresas, valor). |
| `/financeiro/relatorio-procfy` | `RelatorioProcfyPage` | `frontend/src/pages/FinanceiroPage.tsx` | Título "Relatório Procfy". Filtros com rótulo: "Filtrar pela data de", De/Até (mês), situação (vira "Só as pagas" com data de pagamento) e sistema, mais "Pesquisar" e "Gerar Excel". Total de faturas e "Limpar filtros". Tabela de faturas do sistema antigo (empresa, tipo, vencimento, valor, forma de pagamento, pago em, situação em selo, "Ver detalhes") com rodapé do total a receber; modal com valor, desconto, parcela, vencimento e os candidatos da fatura. |
| `/financeiro/holerite` | `GerarHoleritePage` | `frontend/src/pages/FinanceiroPage.tsx` | Filtros com rótulo (empresa, mês, ano), total e "Limpar filtros", e tabela por empresa (empresa, CNPJ, candidatos ativos). A antiga coluna vazia "Lançar Folha" saiu da tela. Não fica no grupo Financeiro: aparece como link solto "Holerite" na barra lateral (`shell.tsx:208`), com a permissão `holerite`. |

Componente compartilhado: `RelatorioEmpresaPainel` (`frontend/src/components/relatorio-empresa.tsx`). É o painel "Relatório" de Faturamento e de Contas a receber. Mostra os candidatos que entram na cobrança, deixa editar ou tirar linhas e envia o relatório com as linhas da tela.

## Arquivos

Frontend
- `frontend/src/pages/FinanceiroPage.tsx`: `GerarFaturamentoPage`, `RelatorioProcfyPage` e `GerarHoleritePage`. O mesmo arquivo tem as telas de Comissão (ver `docs/agentes/comissao/agente.md`) e os auxiliares `useLimpeza` (filtros guardados no estado da tela: diz se há filtro e limpa trocando a `key` do formulário), `EmpresaField`, `MonthField`, `YearField`, `MonthRange`, `NomeEmpresa` (fantasia e razão social com `textoPlano`), `Resumo`, `RodapeTabela` (total + `Paginacao`), `SeloStatus`, `PayDialog`, `lerFiltros` e `TAMANHO = 50`. Usa `CabecalhoPagina`, `CampoFiltro`, `ResumoResultados` e `Alerta` de `frontend/src/components/pagina.tsx`.
- `frontend/src/pages/ContasReceberPage.tsx`
- `frontend/src/pages/ReguaCobrancaPage.tsx`
- `frontend/src/components/relatorio-empresa.tsx` (`RelatorioEmpresaPainel`)
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui`, `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts`
- Rotas em `frontend/src/App.tsx:97-103`. Menu em `frontend/src/components/shell.tsx:47-50` (`financeLinks`), `:206` (grupo Financeiro) e `:208` (Holerite).

Backend
- `backend/src/routes/index.ts`: rotas `/api/v1/asaas/*` (linhas 475-590), `/api/v1/faturamento*` e `/api/v1/procfy*` (622-701), `/api/v1/holerite` (710) e o webhook do Asaas (732).
- `backend/src/services/legado.service.ts` (`LegadoService`, instanciado em `routes/index.ts:621`): `faturamento`, `faturasAbertas`, `relatorioEmpresa`, `sugerirNotas`, `enviarRelatorios`, `procfy`, `planilhaProcfy`, `procfyFatura` e `holerite`. Apesar do nome, lê o Postgres (`dna_work.*`), não o MySQL.
- `backend/src/services/asaas.service.ts` (`AsaasService`): cobranças, notas, webhook e boletos do mês.
- `backend/src/services/regua.service.ts` (`ReguaService`)
- `backend/src/lib/asaas.ts` (`AsaasClient`, chamadas HTTP `/v3/...`)
- `backend/src/lib/regua.ts` (etapas, datas, feriados, agrupamento e planejamento), `regua-execucao.ts` (disparo), `regua-agenda.ts` (relógio diário às 8h, fuso de São Paulo) e `regua-bloqueio.ts` (empresas bloqueadas na régua)
- `backend/src/lib/nota-fiscal.ts` (serviço e ISS sugeridos e id do serviço municipal no Asaas)
- `backend/src/lib/email-modelo.ts` (`enviarModelo`, `textoHtml`) e `backend/src/lib/mailjet.ts`
- `backend/src/lib/paginas.ts` (permissões por página e por prefixo de API)
- `backend/src/app.ts:151-167` (hook que confere a permissão) e `:194-199` (liga a agenda da régua)
- Migrations: `prisma/migrations/20261023180000_asaas`, `20261023220000_regua_cobranca` e `20261109190000_regua_execucao`

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/faturamento?empresa&mes&ano&status&page&pageSize` | Empresas a faturar no mês, a matriz agrupada e `meta.totalReceber`, `meta.asaas` e `meta.conferencia` | `routes/index.ts:623` → `LegadoService.faturamento`, `faturasAbertas` e `AsaasService.aReceber` |
| POST | `/api/v1/faturamento/boletos` `{mes, ano}` | Cria no Asaas um boleto para cada fatura antiga em aberto do mês que ainda não tem `id_asaas` | `routes/index.ts:634` → `AsaasService.boletosDoMes` |
| GET | `/api/v1/faturamento/relatorio?empresa&mes&ano` | Candidatos e valores da empresa no mês | `routes/index.ts:645` → `LegadoService.relatorioEmpresa` |
| POST | `/api/v1/faturamento/relatorios` `{empresas[], mes, ano, itens?}` | Para cada empresa: monta o relatório, garante o boleto e envia o e-mail com relatório e boleto | `routes/index.ts:648` → `LegadoService.enviarRelatorios` e `AsaasService.boletoDoFaturamento` |
| GET | `/api/v1/asaas/cobrancas?de&ate&situacao&id_empresa` | Lista as cobranças (até 200) com as notas e a data do e-mail enviado | `routes/index.ts:530` → `AsaasService.listar` |
| POST | `/api/v1/asaas/cobrancas` | Cria uma cobrança avulsa e envia a fatura por e-mail | `routes/index.ts:512` → `AsaasService.criar` |
| POST | `/api/v1/asaas/cobrancas/:id/sincronizar` | "Verificar": consulta o Asaas, atualiza o status e, se a cobrança foi paga, encerra a régua | `routes/index.ts:549` |
| POST | `/api/v1/asaas/cobrancas/:id/receber` `{data, valor?}` | "Baixar": recebimento em dinheiro no Asaas | `routes/index.ts:556` → `AsaasService.receber` |
| DELETE | `/api/v1/asaas/cobrancas/:id` | "Excluir": apaga a cobrança no Asaas e marca como cancelada | `routes/index.ts:563` → `AsaasService.excluir` |
| GET | `/api/v1/asaas/cobrancas/:id/nota` | Sugere as notas (estágio, CLT ou as duas) | `routes/index.ts:637` → `LegadoService.sugerirNotas` e `notasSugeridas` |
| POST | `/api/v1/asaas/cobrancas/:id/nota` | Agenda e autoriza a nota fiscal no Asaas, uma chamada por nota | `routes/index.ts:566` → `AsaasService.emitirNota` |
| POST | `/api/v1/asaas/notas/:id/pdf` | Busca o PDF da nota (tenta até cerca de 6 s) | `routes/index.ts:585` → `AsaasService.baixarNota` |
| GET | `/api/v1/empresas?q&pageSize=8` | Pesquisa de empresa em Contas a receber | `routes/index.ts:194` (permissão `empresas`) |
| GET | `/api/v1/asaas/regua?competencia=AAAA-MM` | Grupos, unidades, faturas e etapas | `routes/index.ts:475` → `ReguaService.listar` |
| POST | `/api/v1/asaas/regua/simular` `{competencia, data?}` | Lista o que a régua faria no dia, sem enviar nada | `routes/index.ts:478` → `ReguaService.simular` |
| GET | `/api/v1/asaas/regua/:id/relatorio?competencia` | Candidatos ativos ou desligados no mês | `routes/index.ts:481` → `ReguaService.relatorio` |
| POST | `/api/v1/asaas/regua/envios/:id` `{status: enviado\|escalar\|encaminhado}` | Registra uma etapa feita à mão | `routes/index.ts:488` → `ReguaService.registrarEnvio` |
| POST | `/api/v1/asaas/regua/:id/relatorio/email` `{competencia}` | Envia o e-mail "Relatorio cobrança" | `routes/index.ts:495` → `ReguaService.enviarRelatorio` |
| POST | `/api/v1/asaas/regua/:id/comprovante` `{data}` | Registra o comprovante e suspende a régua | `routes/index.ts:502` |
| POST | `/api/v1/asaas/regua/:id/comprovante/validar` | Valida o comprovante e marca como pago | `routes/index.ts:509` |
| GET | `/api/v1/procfy?de&ate&status&tipoData&sistema&page&pageSize` | Faturas antigas e `meta.totalReceber` | `routes/index.ts:698` → `LegadoService.procfy` |
| GET | `/api/v1/procfy/fatura/:id` | Detalhe da fatura com os candidatos | `routes/index.ts:695` → `LegadoService.procfyFatura` |
| GET | `/api/v1/procfy/excel?...` | Baixa `Faturas.xls` (tabela HTML) | `routes/index.ts:689` → `LegadoService.planilhaProcfy` |
| GET | `/api/v1/holerite?empresa&mes&ano&page&pageSize` | Empresas e a quantidade de candidatos ativos no mês | `routes/index.ts:710` → `LegadoService.holerite` |

Rotas do backend que esta tela não chama: `POST /api/v1/asaas/cobrancas/:id/email` (reenvia a fatura), `POST /api/v1/asaas/notas/:id/cancelar` e `POST /api/v1/asaas/webhook`. O webhook é público, protegido pelo cabeçalho `asaas-access-token` comparado com `ASAAS_WEBHOOK_TOKEN`, atualiza o status e encerra a régua quando o pagamento chega.

## Dados

Tudo fica no Postgres. O MySQL do Lightsail não é lido nem gravado por estas telas.

Lidos (schema `dna_work`, cópia do sistema antigo):
- `empresa`: `razao_social`, `nome_fantasia`, `cnpj`, `datafechamento`, `tipo_empresa`, `matriz`, `sede`, `usa_asaas`, `email`, `email_financeiro`, `nome_financeiro`, os campos de endereço e `id_asaas`
- `conratacaovaga` (com esse nome mesmo): `data_contratacao`, `datainicio`, `data_demicao` (texto `AAAA/MM/DD`), `id_candidato`, `id_vaga`
- `vaga` (`tipo_vaga`, `status`, `salario`, `comparador`, `cargo`), `vaga_valores`, `faturamento_empresa`, `candidato`, `modalidade_vaga`
- `fatura` (`mes`, `ano`, `status_fatura` 0/null = aberta, 1 = paga/faturada, 2 = parcial no Faturamento e cancelada no Procfy, `valor_final` em texto, `vencimento_fatura`, `data_pg`, `forma_pg`, `parcela`, `tipo_fatura`, `tipo_cobranca`, `id_asaas`) e `fatura_contratacao` (opcional: o código confere com `to_regclass`)
- `emailsvinculo`, `emails` e `servidor_email`: modelos de e-mail "Geração de cobrança Asaas" e "Relatorio cobrança"

Lidos (schema `public`): `valor_empresas` (`est_status`, `est_mensal`, `est_rs`, `clt_status`, `clt_valor`, `clt_modelo`). É o preço do contrato, editado nas telas de Empresa e Grupos (`frontend/src/components/cobranca-empresa.tsx`).

Gravados:
- `dna_work.cobranca_asaas`: INSERT ao criar uma cobrança e UPDATE de `status`, `situacao`, `data_pagamento`, `valor_liquido` e `url_pagamento` (`asaas.service.ts:177`, `:347`)
- `dna_work.nota_asaas`: INSERT ao emitir a nota e UPDATE de `status` e `pdf_url`
- `dna_work.empresa.id_asaas`: gravado quando o cliente é criado no Asaas (`asaas.service.ts:417`)
- `dna_work.fatura.id_asaas`: gravado em "Gerar boletos do mês" (`asaas.service.ts:154`)
- `dna_work.cobranca_email`: INSERT com `id = max(id)+1` depois que o e-mail de relatório e boleto sai (`legado.service.ts:416`)
- `dna_work.fatura_regua`, `dna_work.fatura_envio` e `dna_work.fatura_regua_log`: régua

Serviços externos:
- Asaas (`ASAAS_API_URL`, `ASAAS_API_KEY`): `/v3/customers`, `/v3/payments`, `/receiveInCash`, `/v3/invoices`, `/authorize`, `/cancel` e `/v3/finance/payment/statistics`
- Mailjet (`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_FROM`, `MAILJET_FROM_NAME`). O e-mail de relatório e boleto do Faturamento usa um remetente fixo no código (`legado.service.ts`, em `enviarRelatorios`).
- Variáveis da régua: `REGUA_AGENDA`, `REGUA_ENVIO_REAL` e `REGUA_INICIO`. Webhook: `ASAAS_WEBHOOK_TOKEN`.
- "Procfy" é só o nome da tela. O código não chama nenhuma API do Procfy: a tela lê `dna_work.fatura`.

## Regras e comportamentos importantes

Permissões (`backend/src/lib/paginas.ts:28-56`; o hook fica em `app.ts:163`). O administrador passa em tudo. Os outros usuários precisam do id da página:
- `/api/v1/asaas/regua*` precisa de `regua`. O resto de `/api/v1/asaas*` precisa de `contas` ou `faturamento`.
- `GET /api/v1/faturamento/relatorio` aceita `faturamento` ou `contas`. Já `POST /api/v1/faturamento/relatorios` não casa com esse prefixo (o código compara com o prefixo seguido de `/`), cai em `/api/v1/faturamento` e exige `faturamento`.
- `/api/v1/procfy` precisa de `procfy` e `/api/v1/holerite` de `holerite`.
- A pesquisa de empresa em Contas a receber chama `/api/v1/empresas`, que exige `empresas`.

Faturamento (`legado.service.ts:98`)
- Entram só empresas com `sede = '10'`, `usa_asaas` igual a 1 ou 2 e vaga com `status` fora de 0, 3, 4, 5 e 6. A empresa precisa de valor maior que 0.
- O período depende de `datafechamento` (dia 10, 20 ou 30) e é montado por `periodo()`. As datas são texto `AAAA/MM/DD` comparado como string.
- Valor por contratação (`VALOR_CONTRATO`, linha 61): se `public.valor_empresas` estiver conferido (`est_status`/`clt_status = 'ok'`), estágio = mensal + taxa de R&S no mês da contratação, e CLT = percentual do salário ou valor fixo, só no mês da contratação. Sem preço conferido, vale o cálculo antigo (`VALOR_LEGADO`, linha 42) com `vaga_valores` e `faturamento_empresa`.
- Filtro de status: "3" = tudo que não está faturado (padrão da tela), "0" = aberta, "1" = faturado e "2" = parcial. O status vem de `max(status_fatura)` em `dna_work.fatura` do mês.
- "Matriz (Sem candidatos)": matrizes de filiais com `usa_asaas = 2` que não aparecem na lista.
- A paginação é feita em memória, depois da consulta inteira. `pageSize` vai até 100.
- "Selecionar todas" busca as páginas 1 e 2 com 100 itens cada. Passando de 200 empresas, o resto fica de fora (o mesmo vale para `todas: true` no backend).
- O envio vai uma empresa por requisição e mostra uma barra de progresso.
- `enviarRelatorios` (linha 301), para cada empresa: pega o primeiro e-mail de `email_financeiro`/`email` (sem e-mail é falha). Total menor ou igual a 0 é falha. Se já existe linha em `cobranca_email` naquele mês/ano, a empresa é pulada antes de gerar o boleto. O boleto vem de `boletoDoFaturamento`, que reaproveita a cobrança aberta com a descrição `Faturamento M/AAAA` ou cria uma (forma BOLETO, sem e-mail do Asaas). O vencimento é o dia 10 do mês seguinte (`vencimentoDia10`). Sem as chaves do Mailjet, o boleto é criado e a resposta volta como falha. Depois do e-mail, grava `cobranca_email`.
- Com `itens` e uma empresa só, as linhas editadas no painel substituem as calculadas (o total é recalculado).

Contas a receber (`ContasReceberPage.tsx`)
- A lista traz no máximo 200 cobranças por vencimento entre De e Até (`asaas.service.ts:86`). O padrão é o mês atual.
- A pesquisa de empresa filtra a tabela no navegador (linhas 92-100). Com a empresa escolhida, mostra só ela. Digitando 2 letras ou mais, filtra pelo nome; com 3 dígitos ou mais, também pelo CNPJ. As entidades HTML (`&amp;`) são limpas.
- "Gerar cobrança" só fica ativo com uma empresa escolhida. O valor aceita "1.500,00" e precisa ser maior que 0. A descrição precisa de 3 a 200 caracteres (zod). O backend cria ou atualiza o cliente no Asaas (`garantirCliente`), cria a cobrança e manda o modelo "Geração de cobrança Asaas". Se o e-mail falhar, a cobrança fica e a tela avisa.
- "Enviar relatório" e o envio em lote só valem para cobranças `aberta`, sem envio e com a descrição exatamente `Faturamento M/AAAA`. Esse envio chama `/api/v1/faturamento/relatorios`, que reaproveita o boleto existente.
- "Excluir" não pede confirmação e apaga a cobrança no Asaas.
- "Baixar" usa `receiveInCash` com o valor cheio e não encerra a régua diretamente: só "Verificar" e o webhook chamam `encerrarPorCobrancaId`/`encerrarPorPaymentId`.
- Nota fiscal (`nota-fiscal.ts`): estágio sai com o código 03158 e ISS 5% ("Administração de estagiários"). CLT sai com 06475 e ISS 5% ("Recrutamento e Seleção"). Uma cobrança mista gera duas notas, divididas proporcionalmente em centavos. Um código fora do mapa `ID_SERVICO` dá erro 422. Se a emissão parar no meio, a tela mantém só as notas que faltam.
- `situacao`: `RECEIVED`, `CONFIRMED` e `RECEIVED_IN_CASH` viram "paga". `DELETED` e `REFUNDED` viram "cancelada". O resto fica "aberta".

Régua (`regua.service.ts` e `lib/regua.ts`)
- Etapas (`lib/regua.ts:15`): relatório (1º dia útil), aviso (dia 5), lembrete (9), vencimento (marco, data real), 1ª a 4ª cobrança (11, 15, 20 e 25) e encaminhar (26). Datas que caem em fim de semana ou feriado nacional passam para o dia útil seguinte.
- A régua lê `cobranca_asaas` com vencimento no mês da competência e que não está cancelada. Filiais entram no grupo da matriz (`agruparRegua`).
- Os botões de ação só aparecem quando a fatura está gravada em `fatura_regua` (`persistida`). A gravação (`materializar`, linha 367) só acontece em `executarReal`, chamado pela agenda diária quando `REGUA_AGENDA=1` e `REGUA_ENVIO_REAL=1`. Sem isso a tela mostra só as etapas "Prevista".
- Status pago bloqueia o registro de envio (409). Suspenso (comprovante registrado) também bloqueia até a validação. "Encaminhar" muda a fatura para `encaminhado`.
- "Simular o dia" não grava nem envia nada. Ignora as empresas em `BLOQUEIOS` (`regua-bloqueio.ts`) e as etapas anteriores a `REGUA_INICIO` (padrão 2026-11-10).

Relatório Procfy (`legado.service.ts:428`)
- `sistema=disc` devolve uma lista vazia (linha 431). Não há integração DISC.
- Com "Tipo data = Pagamento", o status é forçado para "1" (paga) no front e no back.
- Subfaturas ficam de fora. Uma fatura "Aberta" com vencimento passado aparece como "Vencido" em vermelho (cálculo só no front).
- O Excel usa os mesmos filtros, sem paginação, com até 5000 linhas.

Holerite (`legado.service.ts:707`): conta candidatos distintos com `datainicio <= dia 1 do mês` e sem demissão, ou demitidos a partir do dia 1 do mês seguinte. É só leitura. A coluna "Lançar Folha" é vazia: não tem ação.

## Cuidados ao mudar

- `RelatorioEmpresaPainel` e `POST /api/v1/faturamento/relatorios` são usados em Faturamento e em Contas a receber. Mudar o formato da resposta (`enviados`, `boletos`, `pulados`, `falhas`) quebra as mensagens das duas telas.
- A descrição `Faturamento M/AAAA` serve de chave em vários lugares: `boletoDoFaturamento`, a coluna `envio` de `listar`, a sugestão de nota (`routes/index.ts:641`) e `competencia()` no front. Mudar o texto quebra a ligação entre cobrança, e-mail enviado e relatório.
- Risco de boleto duplicado: "Gerar boletos do mês" (`boletosDoMes`) só olha `dna_work.fatura.id_asaas`, não `cobranca_asaas`. Se a empresa já recebeu o boleto por "Enviar relatório e boleto", pode sair um segundo boleto.
- `VALOR_CONTRATO` e os filtros de período estão repetidos em `faturamento` e `relatorioEmpresa`. Mude os dois juntos, senão a lista e o relatório passam a discordar.
- `public.valor_empresas`, editado em Empresas e Grupos, muda o valor faturado.
- A ordem de `REGRAS_API` em `paginas.ts` importa: vale o primeiro prefixo que casa. Um usuário só com `contas` não consegue pesquisar empresa nem enviar relatório pela tela de Contas a receber (403).
- `cobranca_email` recebe o id por `max(id)+1`, sem sequência. Envios simultâneos podem colidir.
- `ASAAS_API_KEY` vazia faz as rotas do Asaas devolverem 503. O cartão "Asaas" do Faturamento mostra "indisponível" em vez de erro.
- Excluir, Baixar e emitir nota agem de verdade no Asaas e na prefeitura. Não teste em produção.
- `meta.conferencia` (faturas antigas em aberto) é calculada no backend, mas a tela não mostra.
- Os filtros de Faturamento, Procfy e Holerite ficam no estado da tela, não na URL. No Faturamento, a situação é lida à parte de `lerFiltros`: "Todas" manda `status=` vazio (o backend aceita todas), sem cair no "3" inicial.
- Visual: as tabelas usam `.data-table` dentro de `Card` (`p-0`), estados com `Skeleton`, `Alerta` e `Empty` (diferencia "nada no mês" de "nada com esses filtros"). Use só classes com remapeamento nos dois temas (`index.css`).

## Como testar

- Faturamento: abra `/financeiro/faturamento`, troque mês, ano e situação e clique em Pesquisar; "Limpar filtros" volta os campos ao mês atual. Abra "Relatório" de uma empresa. Não use "Enviar relatório e boleto" nem "Gerar boletos do mês" fora de um ambiente com Asaas sandbox (`ASAAS_API_URL`).
- Contas a receber: digite parte do nome ou do CNPJ e confira se a tabela filtra. Escolha a empresa na lista, confira "A lista abaixo mostra só ela" e use "Limpar e ver todas". Troque De, Até e Status.
- Régua: escolha a competência, use os filtros de situação e a busca, abra um grupo ("Ver faturas"), "Ver candidatos da fatura" e "Simular o dia". Os botões das etapas ficam desligados enquanto uma ação está sendo gravada.
- Procfy: troque o tipo de data (o Status some com "Pagamento"), abra "Detalhes" e use "Gerar excel".
- Holerite: abra `/financeiro/holerite`.
- Testes automáticos: `backend/test/regua.test.ts` cobre agrupamento, datas, feriados, suspensão, simulação, reserva, consolidação, início e agenda. `backend/test/money.test.ts` cobre `parseMoney`. Não foram encontrados testes de `LegadoService.faturamento`, `AsaasService`, `nota-fiscal.ts` nem das telas.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend` e `npm run agentes:conferir`.
