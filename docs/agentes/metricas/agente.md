# Agente — Métricas

> Última revisão: 2026-11-12 (modo do período, curva e média limitadas a 24 meses)

## Para que serve

Mostra indicadores de gestão que só o administrador vê. Hoje tem a **permanência dos estagiários** (quanto tempo, em média, um estagiário fica contratado, pelo método Kaplan-Meier, com os ativos contando como "ainda não saiu") e **quanto um estagiário rende** pelos preços de cada empresa. Tudo pode ser filtrado pela data de início do contrato.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/metricas` | `MetricasPage` | `frontend/src/pages/MetricasPage.tsx` | Filtro de período (De/Até, na URL como `?de=AAAA-MM-DD&ate=AAAA-MM-DD`, com atalhos Tudo, Últimos 12 meses, ano atual e ano anterior) e, com período escolhido, o seletor "Considerar": "Só quem entrou no período" (padrão) ou "Todos ativos no período" (`&modo=ativos`), indicadores (média restrita, mediana, ativos, contratos analisados), bloco "Quanto um estagiário rende", gráfico "Receita por mês" (histórico + projeção de 12 meses), curva de quantos continuam contratados com o tempo, distribuição de quem já saiu por faixa, tabela por ano de início e nota dos descartes. |

Não tem abas. O item "Métricas" do menu (`shell.tsx`) só aparece para o administrador, logo acima de "Configurações".

## Arquivos

**Frontend**
- `frontend/src/pages/MetricasPage.tsx`: a página (componentes `Indicador` e `Secao` no próprio arquivo). Gráficos com `recharts`, no mesmo estilo escuro do Painel.
- `frontend/src/components/shell.tsx`: item do menu (só `admin`), título da rota e a mensagem "Somente o administrador vê as métricas." para quem não é admin.
- `frontend/src/App.tsx`: rota `/metricas`.

**Backend**
- `backend/src/lib/metricas/permanencia.ts`: regras puras: `dataLegado`, `observacoes`, `kaplanMeier`, `permanenciaEstagio`, `FAIXAS`, `DIAS_POR_MES` (30,44).
- `backend/src/services/metricas.service.ts`: `MetricasService.permanenciaEstagio`, que faz o SELECT e chama as regras.
- `backend/src/routes/index.ts`: rota `GET /api/v1/metricas/permanencia-estagio`.
- `backend/src/app.ts`: bloqueio de `/api/v1/metricas*` para quem não é administrador (mesmo esquema de `/api/v1/configuracoes`).
- `backend/test/metricas-permanencia.test.ts`: testes das regras.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/metricas/permanencia-estagio?de=&ate=&modo=` | Calcula a permanência e a receita dos estagiários (só leitura). `de`/`ate` (AAAA-MM-DD, opcionais) definem o período; `modo` = `inicio` (padrão: só contratos que começaram no período) ou `ativos` (todos que estiveram contratados em algum dia do período). Devolve `calculadoEm`, `periodo`, `lidos`, `foraDoPeriodo`, `validos`, `receita`, `receitaMensal`, `descartados`, `descartes`, `geral` (Kaplan-Meier com `curva`), `encerrados` (média, mediana, faixas) e `porAno`. Só administrador (403 `ACESSO_NEGADO` para os demais). | routes/index.ts → `MetricasService.permanenciaEstagio` |

## Dados

- **Postgres, schema `dna_work`, só leitura:** `conratacaovaga` (`status`, `datainicio`, `data_contratacao`, `data_demicao`) com `JOIN vaga ON id_vaga`, filtrando `vaga.tipo_vaga = 1` (estágio).
- **Preço de cada contrato** (mesma ordem do Faturamento, `VALOR_CONTRATO` em `legado.service.ts`): `public.valor_empresas` conferido (`est_status = 'ok'`: `est_mensal` e `est_rs`) → `dna_work.vaga_valores` pelo `comparador` (`valor_recorrente`, `valor_selecao`/`tipo_selecao`) → `dna_work.faturamento_empresa` da empresa com `modalidade_vaga = 1` (pega uma linha só, via `LATERAL ... LIMIT 1`, porque há empresa com duas). R&S percentual (`tipo_selecao = 'P'`) é % do `vaga.salario`.
- Não lê nem devolve nenhum dado pessoal (nome, CPF, telefone): só datas e status, e a resposta só tem contagens e médias.
- Nada é gravado. O cálculo roda a cada acesso (o front guarda por 5 minutos).

## Regras e comportamentos importantes

- **Início** = `datainicio`; vazio, usa `data_contratacao`. Datas são texto `AAAA/MM/DD`.
- **Fim**: status 2 (encerrado) termina em `data_demicao`; status 1 (ativo) conta até hoje e é **censurado**.
- **Descartes**: data fora do formato (ou impossível), demissão antes do início, encerrado sem data de demissão, ativo com início no futuro e status diferente de 1/2. A página mostra quantos de cada.
- **Kaplan-Meier**: a mediana é o primeiro tempo em que a curva fica ≤ 50%; a média restrita é a área sob a curva até o maior tempo observado, **sem passar de 24 meses** (`LIMITE_DIAS`, Lei 11.788/2008, art. 11). Sem esse limite, contratos registrados com até ~54 meses (datas erradas ou renovações) inflavam a média: nos últimos 12 meses, modo `ativos`, ela ia de 6,9 para 9,0 meses. Meses = dias / 30,44.
- **Só encerrados**: média e mediana aparecem como comparação; ficam mais baixas porque ignoram os ativos. Não use como "permanência média".
- **Por ano de início**: Kaplan-Meier em cada ano. A média restrita de cada ano vai só até o maior tempo observado naquele ano, então anos recentes não são comparáveis por ela; a página avisa e marca anos com menos de 60 contratos como "poucos contratos".
- **Curva de permanência**: o eixo vai de 0 a 24 meses, porque o estágio na mesma empresa não passa de 2 anos (Lei 11.788/2008, art. 11). A média restrita também para em 24 meses; a mediana não muda (fica bem antes).
- **Receita** (`receita` em `permanencia.ts`): só entram contratos de empresa com taxa mensal > 0 (os outros aparecem como "sem taxa mensal cadastrada").
  - receita média por estagiário = taxa mensal média × permanência média (média restrita em meses) + taxa de R&S média;
  - receita esperada dos contratos = receita média × contratos com valor;
  - já rendido até hoje = soma de taxa mensal × meses cumpridos (até a saída ou até hoje) + R&S.
  - É estimativa: não usa o que foi faturado de fato (`fatura`/Asaas), nem atrasos, descontos ou meses parciais.
- **Taxa de R&S** (entra na conta, mas não aparece como indicador na página, a pedido): taxa de recrutamento e seleção, cobrada uma vez na contratação (`valor_empresas.est_rs` ou a seleção do cadastro antigo). Em 12/11/2026 só 13 das 81 empresas com preço conferido cobravam (≈ R$ 109 em média), por isso a média por estagiário fica perto de R$ 7.
- **Receita por mês** (`receitaMensal` em `permanencia.ts`), só contratos com taxa mensal:
  - meses passados (até o mês anterior ao atual): taxa mensal proporcional aos dias ativos no mês + R&S no mês de início;
  - mês atual e os 11 seguintes: só os ativos de hoje, cada um × a chance de continuar no meio do mês, `S(a + Δ) / S(a)` pela curva de Kaplan-Meier (`sobrevivencia`; depois do fim da curva mantém o último valor). Não inclui contratações novas, então a projeção sempre cai;
  - o mês atual é todo projeção: não soma quem saiu no começo do mês.
  - cada mês traz `estagiarios` (quantos passaram pelo mês, ou quantos se espera na projeção) e `mesesCheios` (soma das frações do mês que cada um ficou). O tooltip mostra os dois. Quem entra ou sai no meio do mês paga só os dias dele: em out/2026 foram 231 estagiários, mas o equivalente a 208 meses cheios (34 entraram e 17 saíram no meio do mês), e por isso a projeção de nov/2026 (≈ 219 esperados, todos pagando o mês inteiro) ficou maior.
- **Período** (`dentro` em `permanencia.ts`): os de fora contam em `foraDoPeriodo`; os descartes contam todos os contratos lidos.
  - `inicio`: entra quem começou entre `de` e `ate`. A receita por mês mostra só o que esses contratos renderam (menor que a receita total da empresa no mês).
  - `ativos`: entra quem tinha início ≤ `ate` e fim (demissão, ou hoje se ativo) ≥ `de`. A receita por mês fica igual à de "Tudo" nos meses do período. A permanência fica maior (viés de duração: contratos longos têm mais chance de cruzar o período); em 12/11/2026, nos últimos 12 meses, foi 6,9 meses contra 5,3 no modo `inicio`.
  - Com período, o gráfico de receita mostra só os meses do período; a projeção só aparece se o período chega ao mês atual.
  - Período recente no modo `inicio` tem média restrita curta (ainda não deu tempo de observar contratos longos).
- Referência: em 12/11/2026, sem filtro: receita média ≈ R$ 709 por estagiário (taxa mensal média ≈ R$ 138, R&S ≈ R$ 6,60), 1.313 contratos com preço e 56 sem. Também em 12/11/2026, 1.396 contratos lidos, 1.369 válidos, 27 descartados; média restrita ≈ 5,1 meses (5,3 antes do limite de 24 meses), mediana ≈ 3,3 meses, 227 ativos.

## Cuidados ao mudar

- O acesso é por `sessao.admin`, não pela lista de páginas de `lib/paginas.ts`. Não registre `/api/v1/metricas` em `REGRAS_API` nem crie um id de página, senão um usuário comum poderia ganhar acesso pela tela de Configurações.
- Novas métricas: acrescente rotas em `/api/v1/metricas/...` (o bloqueio de admin já cobre o prefixo) e seções nesta página; atualize este arquivo.
- Mantenha a resposta sem dados pessoais.
- Se mudar a regra de preço do Faturamento (`VALOR_CONTRATO`), mude `MENSAL`/`RS` em `metricas.service.ts` também.
- As regras de `permanencia.ts` são testadas; ao mudar o cálculo, ajuste `metricas-permanencia.test.ts` e confira com a referência acima.

## Como testar

- `npx tsx --test test/metricas-permanencia.test.ts` dentro de `backend`.
- Entre como administrador e abra `/metricas`: confira os indicadores, o bloco de receita, os atalhos de período (2025 deve dar 700 contratos e ≈ 4,5 meses, igual à linha 2025 da tabela), a curva (começa em 100% e cruza a linha de 50% perto de 3,3 meses), as faixas e a tabela por ano.
- Com um usuário que não é administrador: o menu não mostra "Métricas", `/metricas` mostra "Somente o administrador vê as métricas." e a API responde 403.
