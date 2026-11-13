# Agente — Comissão

> Última revisão: 2026-11-13 (commit "Repagina as telas restantes no padrão novo")

## Para que serve

Mostra as comissões de vendas registradas no sistema antigo. "Consultar" lista os pagamentos de comissão por fatura: vendedor, treinamento, valor, se o boleto foi pago e se a comissão foi paga. "Empresas" lista as empresas com comissão de cadastro: vendedor, data de cadastro, 1ª contratação, 1ª vaga, tipo e valor. As duas telas são só de consulta. O botão "Pagar Comissão" ainda não grava nada.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/financeiro/comissao` | `ComissaoConsultarPage` | `frontend/src/pages/FinanceiroPage.tsx` | Título "Comissão" com "Pagar comissão" no cabeçalho. Filtros com rótulo: empresa, consultor, mês, ano e situação, mais total e "Limpar filtros". Tabela com empresa (CNPJ embaixo), vencimento, boleto (selo), itens, vendedor, treinamento, comissão, pago em e situação (selo). Rodapé com "Total das comissões no filtro" e a paginação. |
| `/financeiro/comissao/empresas` | `ComissaoEmpresasPage` | `frontend/src/pages/FinanceiroPage.tsx` | Título "Comissão de empresas", mesmo botão no cabeçalho e mesmos filtros. Tabela com empresa, vendedor, cadastro, 1ª contratação, 1ª vaga aberta, tipo, valor e situação. Mesmo rodapé. |

No menu, as duas ficam no grupo "Comissão" (`frontend/src/components/shell.tsx:54-55`, `comissaoLinks`, e `:207`). "Consultar" usa `end: true` para não ficar ativa em `/empresas`. A ordem em `shell.tsx:59-60` põe `/financeiro/comissao/empresas` antes de `/financeiro/comissao`.

## Arquivos

Frontend
- `frontend/src/pages/FinanceiroPage.tsx`: `ComissaoFilters`, `BotaoPagarComissao`, `ComissaoConsultarPage` e `ComissaoEmpresasPage`. Usa os auxiliares do mesmo arquivo: `useLimpeza`, `RodapeTabela`, `NomeEmpresa`, `SeloStatus`, `PayDialog`, `lerFiltros`, `MonthField`, `YearField`, `EmpresaField` e `TAMANHO = 50`. O arquivo também tem as telas do Financeiro (ver `docs/agentes/financeiro/agente.md`).
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui`, `frontend/src/lib/api.ts` e `frontend/src/lib/format.ts` (`money`, `dateBr`, `formatCnpj`)
- Rotas em `frontend/src/App.tsx:101-102`

Backend
- `backend/src/routes/index.ts:702-709`: `GET /api/v1/comissao/empresas` e `GET /api/v1/comissao`
- `backend/src/services/legado.service.ts`: `comissao` (linha 593) e `comissaoEmpresas` (linha 646). `LegadoService` lê o Postgres, schema `dna_work`.
- `backend/src/lib/paginas.ts`: páginas `comissao` e `comissao-empresas` e regras de API

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/comissao?empresa&consultor&mes&ano&status&page&pageSize` | Pagamentos de comissão paginados, com `meta.total` e `meta.totalReceber` (soma de `ValorFinalComissao`) | `routes/index.ts:706` → `LegadoService.comissao` |
| GET | `/api/v1/comissao/empresas?empresa&consultor&mes&ano&status&page&pageSize` | Empresas com comissão paginadas, com `meta.totalReceber` (soma de `valor_comisao_empresa`) | `routes/index.ts:702` → `LegadoService.comissaoEmpresas` |

`pageSize` vai de 1 a 100 (padrão 50; a tela manda 50). Não existe rota para pagar comissão.

## Dados

Só leitura, no Postgres, schema `dna_work` (cópia do sistema antigo). Nada é gravado e nenhum serviço externo é chamado.

Consultar (`comissao`)
- `dna_work.pagamento_comissao` (alias `p`): `nome_fantasia`, `razao_social`, `cnpj`, `mes`, `ano`, `vencimento_fatura`, `data_pg_comissao`, `"ValorFinalComissao"`, `usuario`, `"VendedorBase"`, `treinamento`, `id_fatura`. Os nomes com maiúscula precisam de aspas.
- `dna_work.pagamento_comissao_vagas`: `count(*)` por `id_pagamento` vira a coluna "Itens"
- `dna_work.fatura`: `status_fatura` vira "Status Boleto" (1 = Pago, 0 = Aberto, outro valor = "—")

Empresas (`comissaoEmpresas`)
- `dna_work.empresa`: `nome_fantasia`, `razao_social`, `cnpj`, `data_adicao`, `forma_comissao` (coluna "Tipo"), `valor_comisao_empresa` (escrito assim mesmo, com um "s"), `usuario`
- `dna_work.usuario`: `u_id` e `u_nome` (vendedor)
- `dna_work.fatura_pagamento_comissao_empresa`: `id_empresa`, `mes` e `ano`. Ter uma linha significa "Pago".
- `dna_work.vaga` (`min(dataabertura)`) e `dna_work.conratacaovaga` (`min(data_contratacao)`)

## Regras e comportamentos importantes

- Permissão (`paginas.ts`): `/api/v1/comissao/empresas` exige `comissao-empresas` e `/api/v1/comissao` exige `comissao`. A regra de `/empresas` vem antes na lista, então quem tem só `comissao` recebe 403 na aba Empresas. O administrador passa em tudo.
- Filtros iniciais: só `ano` = ano atual (`inicial = { ano: nowYear() }`). O mês começa em "Todos" (`MonthField todos`). `lerFiltros` descarta campos vazios.
- O select "Consultor" tem uma lista fixa de 3 nomes no código (`ComissaoFilters` em `FinanceiroPage.tsx`), mais "Todos". "todos" vira sem filtro no backend.
- Em Consultar, o consultor filtra por `ILIKE` em `usuario`, `"VendedorBase"` ou `treinamento`. Em Empresas, filtra por `u_nome`.
- Status. Em Consultar: "1" = `data_pg_comissao` preenchida (Pago) e "0" = vazia (Aberta). Em Empresas: "1" = existe linha em `fatura_pagamento_comissao_empresa` no mês/ano e "0" = não existe.
- Mês e ano. Em Consultar, filtram `p.mes`/`p.ano` (o mês sem zero à esquerda). Em Empresas, o mês filtra a data de cadastro (`data_adicao` começando com `AAAA/MM` ou `AAAA-MM`) e o mês/ano do pagamento no join. Sem ano, o backend usa o ano atual.
- O valor em texto com vírgula é convertido. Fora do formato numérico conta como 0 na soma e aparece como "—" na linha quando vazio.
- Ordem: Consultar por `ano DESC, mes DESC, nome_fantasia`. Empresas por `nome_fantasia`.
- O rodapé diz "Total das comissões no filtro": é a soma das comissões do filtro inteiro, não só da página (`meta.totalReceber`). A contagem fica em `ResumoResultados`, acima da tabela. "Limpar filtros" volta ao ano atual e troca a `key` do formulário para os campos voltarem ao padrão.
- "Pagar comissão" abre `PayDialog`. A data não é lida, e "Confirmar" e "Cancelar" só fecham o modal; o modal avisa que o pagamento ainda não é gravado. Nenhuma API é chamada. As caixas "Selecionar todos" e a coluna vazia das linhas, que não tinham ação, saíram da tela.

## Cuidados ao mudar

- `FinanceiroPage.tsx` é compartilhado com Faturamento, Procfy e Holerite. `useLimpeza`, `RodapeTabela`, `NomeEmpresa`, `SeloStatus`, `MonthField` e `lerFiltros` são usados pelas outras telas. Mudar esses auxiliares afeta o Financeiro.
- Para implementar o pagamento de comissão de verdade, é preciso criar uma rota nova (hoje não existe) e decidir onde gravar. `data_pg_comissao` e `fatura_pagamento_comissao_empresa` são as colunas e tabelas que o status lê. Lembre que `dna_work` é a cópia do sistema antigo.
- A lista de consultores é fixa. Um consultor novo não aparece até alguém editar o código.
- Os filtros de Empresas montam `LIKE` com `$4 || '/' || lpad($3, 2, '0')`. As datas do sistema antigo vêm como texto em formatos mistos.
- As regras de permissão dependem da ordem em `REGRAS_API` (`paginas.ts`).

## Como testar

- Abra `/financeiro/comissao`, troque consultor, mês, ano e status e clique em Pesquisar. Confira a paginação e o total no rodapé.
- Abra `/financeiro/comissao/empresas` e faça o mesmo. Com um usuário que tenha só a página `comissao`, a aba Empresas deve dar "Você não tem acesso a esta página."
- Testes automáticos: não encontrado nenhum teste para comissão (backend ou frontend).
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend` e `npm run agentes:conferir`.
