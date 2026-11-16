# Agente — Métricas

> Última revisão: 2026-11-16 (aba Geral: dica com quantidades e receita recorrente)

## Para que serve

Mostra indicadores de gestão que só o administrador vê. Hoje tem a **permanência dos estagiários** (quanto tempo, em média, um estagiário fica contratado, pelo método Kaplan-Meier, com os ativos contando como "ainda não saiu") e **quanto um estagiário rende** pelos preços de cada empresa (aba **Estágio**), e as **contratações CLT** com a receita delas, cobrada uma vez por contratação, e projeções de receita (aba **CLT**, sem métricas de tempo), e a aba **Geral**, que soma as duas. Tudo pode ser filtrado por período.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
|---|---|---|---|
| `/metricas` (aba Estágio, padrão) | `MetricasPage` → `MetricasEstagio` | `frontend/src/pages/MetricasPage.tsx` | Abas Estágio/CLT no topo; filtro de período (De/Até, na URL como `?de=AAAA-MM-DD&ate=AAAA-MM-DD`, com atalhos Tudo, Últimos 12 meses, ano atual e ano anterior) e, com período escolhido, o seletor "Considerar": "Só quem entrou no período" (padrão) ou "Todos ativos no período" (`&modo=ativos`), indicadores (média restrita, mediana, ativos, contratos analisados), bloco "Quanto um estagiário rende", gráfico "Receita por mês" (histórico + projeção de 12 meses), curva de quantos continuam contratados com o tempo, distribuição de quem já saiu por faixa, tabela por ano de início e nota dos descartes. |
| `/metricas?tipo=geral` (aba Geral) | `MetricasGeral` | `frontend/src/components/metricas-geral.tsx` | Estágio + CLT: receita realizada (com a divisão), contratações, participação do estágio e do CLT na receita, estagiários ativos; "Projeções" somadas (próximos 12 meses, fechamento do ano, média por mês, cada uma com a divisão estágio/CLT); "Receita por mês" com estágio e CLT empilhados e as duas projeções, e a opção "Simular novas contratações de estágio" (novos por mês e crescimento ao mês, na URL como `simular=1&novos=&crescimento=`). Usa o mesmo filtro e o "Considerar" (que vale só para o estágio). |
| `/metricas?tipo=clt` (aba CLT) | `MetricasClt` | `frontend/src/components/metricas-clt.tsx` | Mesmo filtro de período (sem o "Considerar": sempre pela data de início), indicadores (contratações, receita das contratações, receita média por contratação, taxa média sobre o salário), bloco "Projeções" (base e fator, próximos 12 meses, fechamento do ano, média por mês, últimos 3 meses com a tendência, e o mês atual contra o esperado, cada um com a conta escrita), gráfico "Receita por mês" (realizado + 12 meses projetados, variando mês a mês) e nota dos descartes. **Não mostra métricas de tempo** (permanência, curva, faixas, por ano), a pedido. |

O erro de carregamento aparece com `Alerta` (de `components/pagina.tsx`), no mesmo formato das outras telas.

A aba fica na URL (`tipo=clt` ou `tipo=geral`; sem o parâmetro, Estágio). O período e o modo ficam na URL e valem para as duas abas. O item "Métricas" do menu (`shell.tsx`) só aparece para o administrador, logo acima de "Configurações".

## Arquivos

**Frontend**
- `frontend/src/pages/MetricasPage.tsx`: a página, as abas, o filtro de período e a aba Estágio (`MetricasEstagio`). Gráficos com `recharts`, no mesmo estilo escuro do Painel.
- `frontend/src/components/metricas.tsx`: peças comuns às duas abas (`Indicador`, `Secao`, `CurvaPermanencia`, `FaixasSaida`, `TabelaPorAno`, `NotaDescartes`, formatadores, os tipos `ResumoPermanencia` e `PermanenciaEstagio` e o `useMetricasEstagio`). Toda dica (`Tooltip`) usa `itemStyle={textoTooltip}`: sem isso o texto sai na cor da série, e a barra clara da projeção fica ilegível.
- `frontend/src/components/metricas-geral.tsx`: aba Geral (`MetricasGeral`). Não tem API própria: usa `useMetricasEstagio` e `useMetricasClt` (mesmo cache das outras abas) e soma no navegador.
- `frontend/src/components/metricas-clt.tsx`: aba CLT (`MetricasClt`) e `useMetricasClt`. Não usa `CurvaPermanencia`, `FaixasSaida` nem `TabelaPorAno`.
- `frontend/src/components/shell.tsx`: item do menu (só `admin`), título da rota e a mensagem "Somente o administrador vê as métricas." para quem não é admin.
- `frontend/src/App.tsx`: rota `/metricas`.

**Backend**
- `backend/src/lib/metricas/permanencia.ts`: regras puras: `dataLegado`, `observacoes`, `kaplanMeier`, `resumoPermanencia` (comum a estágio e CLT), `permanenciaEstagio`, `baseSimulacao`, `receita`, `receitaMensal`, `FAIXAS`, `DIAS_POR_MES` (30,44), `LIMITE_DIAS`.
- `backend/src/lib/metricas/clt.ts`: `metricasClt`, `receitaClt`, `receitaMensalClt`, `ritmo`, `projecaoClt`, `SALARIO_MENSAL_MINIMO`.
- `backend/src/services/metricas.service.ts`: `MetricasService.permanenciaEstagio` e `MetricasService.contratacoesClt`, que fazem o SELECT (`sqlContratos`) e chamam as regras. Preços em `MENSAL`, `RS` (estágio) e `TAXA_CLT`.
- `backend/src/routes/index.ts`: rotas `GET /api/v1/metricas/permanencia-estagio` e `GET /api/v1/metricas/contratacoes-clt`.
- `backend/src/app.ts`: bloqueio de `/api/v1/metricas*` para quem não é administrador (mesmo esquema de `/api/v1/configuracoes`).
- `backend/test/metricas-permanencia.test.ts` e `backend/test/metricas-clt.test.ts`: testes das regras.

## API usada

| Método | Caminho | O que faz | Onde está no backend |
|---|---|---|---|
| GET | `/api/v1/metricas/permanencia-estagio?de=&ate=&modo=` | Calcula a permanência e a receita dos estagiários (só leitura). `de`/`ate` (AAAA-MM-DD, opcionais) definem o período; `modo` = `inicio` (padrão: só contratos que começaram no período) ou `ativos` (todos que estiveram contratados em algum dia do período). Devolve `calculadoEm`, `periodo`, `lidos`, `foraDoPeriodo`, `validos`, `receita`, `receitaMensal` (cada mês com `rs`, a parte de R&S), `simulacao`, `descartados`, `descartes`, `geral` (Kaplan-Meier com `curva`), `encerrados` (média, mediana, faixas) e `porAno`. Só administrador (403 `ACESSO_NEGADO` para os demais). | routes/index.ts → `MetricasService.permanenciaEstagio` |
| GET | `/api/v1/metricas/contratacoes-clt?de=&ate=` | Contratações CLT (só leitura). O período filtra sempre pela data de início. Devolve o mesmo resumo de permanência (`geral`, `encerrados`, `porAno`, descartes) mais `receita` (`total`, `porContratacao`, `contratacoesComValor`, `semValor`, `salarioMedio`, `percentualMedio`) e `receitaMensal` (`mes`, `receita`, `contratacoes`) e `projecao` (`ritmo12`, `ritmo3`, `tendencia`, `base` com as duas janelas e os fatores, `mesAtual`, `proximos12`, `ano`, `serie` com o mês-base de cada mês). Só administrador. | routes/index.ts → `MetricasService.contratacoesClt` |

## Dados

- **Postgres, schema `dna_work`, só leitura:** `conratacaovaga` (`status`, `datainicio`, `data_contratacao`, `data_demicao`) com `JOIN vaga ON id_vaga`, filtrando `vaga.tipo_vaga = 1` (estágio).
- **Preço de cada contrato** (mesma ordem do Faturamento, `VALOR_CONTRATO` em `legado.service.ts`): `public.valor_empresas` conferido (`est_status = 'ok'`: `est_mensal` e `est_rs`) → `dna_work.vaga_valores` pelo `comparador` (`valor_recorrente`, `valor_selecao`/`tipo_selecao`) → `dna_work.faturamento_empresa` da empresa com `modalidade_vaga = 1` (pega uma linha só, via `LATERAL ... LIMIT 1`, porque há empresa com duas). R&S percentual (`tipo_selecao = 'P'`) é % do `vaga.salario`.
- **Taxa de cada contratação CLT** (`TAXA_CLT`, mesma ordem do Faturamento): `public.valor_empresas` conferido (`clt_status = 'ok'`: `clt_modelo = 'Percentual'` → `vaga.salario × clt_valor / 100`; senão `clt_valor` fixo) → seleção do cadastro antigo (`vaga_valores`/`faturamento_empresa` com `modalidade_vaga = 2`, `tipo_selecao` P = % do salário, senão valor fixo). Não há mensalidade em CLT.
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
  - mês atual e os 12 seguintes (13 barras; a aba Geral usa os 12 depois do atual): só os ativos de hoje, cada um × a chance de continuar no meio do mês, `S(a + Δ) / S(a)` pela curva de Kaplan-Meier (`sobrevivencia`; depois do fim da curva mantém o último valor). Não inclui contratações novas, então a projeção sempre cai;
  - o mês atual é todo projeção: não soma quem saiu no começo do mês.
  - cada mês traz `estagiarios` (quantos passaram pelo mês, ou quantos se espera na projeção) e `mesesCheios` (soma das frações do mês que cada um ficou). O tooltip mostra os dois. Quem entra ou sai no meio do mês paga só os dias dele: em out/2026 foram 231 estagiários, mas o equivalente a 208 meses cheios (34 entraram e 17 saíram no meio do mês), e por isso a projeção de nov/2026 (≈ 219 esperados, todos pagando o mês inteiro) ficou maior.
- **Período** (`dentro` em `permanencia.ts`): os de fora contam em `foraDoPeriodo`; os descartes contam todos os contratos lidos.
  - `inicio`: entra quem começou entre `de` e `ate`. A receita por mês mostra só o que esses contratos renderam (menor que a receita total da empresa no mês).
  - `ativos`: entra quem tinha início ≤ `ate` e fim (demissão, ou hoje se ativo) ≥ `de`. A receita por mês fica igual à de "Tudo" nos meses do período. A permanência fica maior (viés de duração: contratos longos têm mais chance de cruzar o período); em 12/11/2026, nos últimos 12 meses, foi 6,9 meses contra 5,3 no modo `inicio`.
  - Com período, o gráfico de receita mostra só os meses do período; a projeção só aparece se o período chega ao mês atual.
  - Período recente no modo `inicio` tem média restrita curta (ainda não deu tempo de observar contratos longos).
- **CLT** (`clt.ts`):
  - receita = soma das taxas das contratações com taxa > 0, no mês de início (não tem projeção, porque não há recorrência);
  - permanência: o backend ainda calcula (mesmo Kaplan-Meier, sem o limite de 24 meses), mas a tela **não mostra métricas de tempo** em CLT, a pedido;
  - **projeções** (`projecaoClt`), sempre com **todas** as contratações (o filtro de período não muda):
    - cada mês projetado = valor do **mesmo mês** nos últimos 12 meses completos × **fator**; fator = total dos últimos 12 meses ÷ total dos 12 meses antes deles (receita e contratações, cada um com o seu). Assim a projeção repete a sazonalidade do último ano e acompanha a tendência; não fica reta;
    - próximos 12 meses = soma dos 12 meses projetados, do mês seguinte ao atual (= últimos 12 meses × fator);
    - fechamento do ano = realizado no ano até hoje + o que falta para o mês atual chegar no esperado (mesmo mês do ano anterior × fator; zero se já passou) + meses projetados que ainda caem no ano;
    - "Média por mês" (últimos 12 ÷ 12) e "Últimos 3 meses" (com a `tendencia` em % sobre a média de 12) ficam como referência;
    - a tela mostra a conta de cada número (linha "Base" e texto embaixo de cada card) e o tooltip de cada barra projetada mostra o mês-base e o fator;
    - o gráfico acrescenta as 12 barras projetadas só quando o período chega ao mês atual;
    - é ordem de grandeza: não prevê vagas novas, mudança de preço nem clientes novos. Em 16/11/2026: nov/25–out/26 R$ 75.050 (44 contratações), nov/24–out/25 R$ 86.471 (57), fator 0,87 (−13,2%); próximos 12 meses ≈ R$ 65,1 mil (≈ 34 contratações); fechamento de 2026 ≈ R$ 71,9 mil (R$ 51,3 mil realizados + R$ 3,6 mil do mês atual + R$ 17,0 mil de dez/26).
  - salário médio e % do salário só com salário ≥ R$ 500 (`SALARIO_MENSAL_MINIMO`): há vagas com salário por hora ("24,00", "25,00") e taxa fixa, que davam % absurdo. O % é soma das taxas ÷ soma dos salários;
  - período: sempre pela data de início (o seletor "Considerar" não aparece na aba CLT); com período, o gráfico mostra todos os meses do período, inclusive os zerados.
  - Referência em 16/11/2026, sem filtro: 151 contratações lidas, 148 válidas, 104 ainda contratadas, 143 com taxa e 5 sem; receita ≈ R$ 207,6 mil, ≈ R$ 1.451 por contratação, salário médio ≈ R$ 2.142, taxa ≈ 67,9% do salário.
- **Aba Geral** (`metricas-geral.tsx`):
  - receita realizada = soma das barras de estágio (até o mês passado) + receita total de CLT (inclui o mês atual);
  - próximos 12 meses = estágio projetado + CLT projetado nos 12 meses depois do atual. **As duas projeções são contas diferentes**: o estágio só tem os ativos de hoje (sem contratações novas); o CLT supõe contratações novas no ritmo do último ano. A tela avisa;
  - fechamento do ano só aparece quando o gráfico cobre o ano todo (Tudo, ou período que começa até 1º de janeiro e chega ao mês atual); senão mostra "—" com a explicação;
  - média por mês = barras de estágio dos 12 meses completos ÷ 12 + média de CLT;
  - por isso a projeção de estágio vai do mês atual até 12 meses depois (13 barras).
  - **Dica do gráfico** (`DicaMes`): para cada série do mês, valor e quantidade (estagiários que passaram pelo mês, ≈ estagiários esperados, ≈ estagiários novos simulados, contratações CLT ou ≈ contratações projetadas), o total, a parte **recorrente** e a parte **única**.
  - **Recorrente** = mensalidades de estágio (realizado − R&S, mais projeção dos ativos, mais simulado − R&S simulado). **Único** = CLT + taxa de R&S. O backend manda o R&S de cada mês do histórico em `receitaMensal[].rs` (0 na projeção).
  - Card **Receita recorrente** (em Projeções): média das mensalidades de estágio nos últimos 12 meses completos, o % sobre a "Média por mês" (mesma base do card ao lado) e o valor do último mês completo. Em 16/11/2026, sem filtro, perto de R$ 30 mil por mês (a média de estágio era R$ 30,1 mil e o R&S é pequeno).
  - **Simulação de novas contratações de estágio** (`simularEstagio` em `metricas-geral.tsx`, base em `baseSimulacao` de `permanencia.ts`, campo `simulacao` da resposta de estágio):
    - base (sempre com todos os contratos, o período não muda): contratações por mês = contratos que começaram nos 12 meses completos ÷ 12 (≈ 36 em 16/11/2026); taxa mensal e R&S médias desses contratos; `permanencia[k]` = S(k × 30,44 dias) de 0 a 24 meses;
    - turma do mês j (a partir do mês seguinte) = novos × (1 + crescimento)^(j−1); no mês em que começa paga meio mês + R&S; k meses depois, taxa mensal × `permanencia[k]`; depois de 24 meses, nada (lei do estágio);
    - entra no gráfico como "Estágio (novas contratações simuladas)" (verde) e soma em "Próximos 12 meses" e "Fechamento do ano", com a parte simulada escrita embaixo;
    - conferência: no ritmo atual (36/mês, 0%) a receita simulada + ativos se estabiliza perto da receita de estágio de hoje (≈ R$ 30 mil/mês); próximos 12 meses ≈ R$ 418 mil (R$ 154 mil ativos + R$ 199 mil simulados + R$ 65 mil CLT). Com 50/mês e 5%: ≈ R$ 562 mil.
  - Referência em 16/11/2026, sem filtro: receita realizada ≈ R$ 935 mil (R$ 728 mil estágio, R$ 208 mil CLT; 77,8% estágio), 1.517 contratações; próximos 12 meses ≈ R$ 219 mil (R$ 154 mil estágio + R$ 65 mil CLT); fechamento de 2026 ≈ R$ 413 mil; média ≈ R$ 36,4 mil por mês.
- Referência: em 12/11/2026, sem filtro: receita média ≈ R$ 709 por estagiário (taxa mensal média ≈ R$ 138, R&S ≈ R$ 6,60), 1.313 contratos com preço e 56 sem. Também em 12/11/2026, 1.396 contratos lidos, 1.369 válidos, 27 descartados; média restrita ≈ 5,1 meses (5,3 antes do limite de 24 meses), mediana ≈ 3,3 meses, 227 ativos.

## Cuidados ao mudar

- O acesso é por `sessao.admin`, não pela lista de páginas de `lib/paginas.ts`. Não registre `/api/v1/metricas` em `REGRAS_API` nem crie um id de página, senão um usuário comum poderia ganhar acesso pela tela de Configurações.
- Novas métricas: acrescente rotas em `/api/v1/metricas/...` (o bloqueio de admin já cobre o prefixo) e seções nesta página; atualize este arquivo.
- Mantenha a resposta sem dados pessoais.
- Se mudar a regra de preço do Faturamento (`VALOR_CONTRATO`), mude `MENSAL`/`RS`/`TAXA_CLT` em `metricas.service.ts` também.
- As regras de `permanencia.ts` são testadas; ao mudar o cálculo, ajuste `metricas-permanencia.test.ts` e confira com a referência acima.

## Como testar

- `npx tsx --test test/metricas-permanencia.test.ts test/metricas-clt.test.ts` dentro de `backend`.
- Aba Geral com `&simular=1`: confira 36 por mês no padrão, a faixa verde no gráfico e o valor simulado somado nos cards; mude os campos e veja tudo recalcular.
- Aba Geral (`/metricas?tipo=geral`): sem filtro, confira que receita, próximos 12 meses e fechamento batem com a soma das abas Estágio e CLT; com 2025, as projeções somem e aparece o aviso.
- Aba CLT (`/metricas?tipo=clt`): sem filtro, confira ≈ 148 contratações e ≈ R$ 1.451 por contratação, o bloco Projeções (≈ R$ 65 mil nos próximos 12 meses em 16/11/2026) e as 12 barras claras variando no fim do gráfico; escolha 2025 e veja as projeções iguais e o gráfico sem as barras projetadas.
- Entre como administrador e abra `/metricas`: confira os indicadores, o bloco de receita, os atalhos de período (2025 deve dar 700 contratos e ≈ 4,5 meses, igual à linha 2025 da tabela), a curva (começa em 100% e cruza a linha de 50% perto de 3,3 meses), as faixas e a tabela por ano.
- Com um usuário que não é administrador: o menu não mostra "Métricas", `/metricas` mostra "Somente o administrador vê as métricas." e a API responde 403.
