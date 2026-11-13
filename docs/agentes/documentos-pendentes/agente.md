# Agente — Documentos pendentes

> Última revisão: 2026-11-13 (commit "Botões com retorno de clique e Pesquisar sempre recarrega")

## Para que serve

Relatório somente leitura dos documentos de candidatos que foram gerados no sistema antigo e ainda não voltaram assinados (devolução pendente). Mostra vencimento, dias de atraso, tipo de assinatura (manual ou digital), modalidade da vaga, empresa, situação do vínculo e as instruções da empresa. Não há ação de gravar nesta tela.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/documentos-pendentes` | `DocumentosPendentesPage` | `frontend/src/pages/NovasAbasPage.tsx:108-240` | Título "Documentos pendentes" (`CabecalhoPagina`). Filtros em `CampoFiltro`: Modalidade da vaga, Empresa, Documento (lista fixa de 23 nomes), Candidato, Vencimento de, Vencimento até e botão Pesquisar. `ResumoResultados` com total e "Limpar filtros". Tabela `data-table` (blocos em telas estreitas) com 8 colunas: Candidato (tipo de assinatura embaixo), Documento, Empresa (modalidade embaixo), Início, Vencimento, Atraso ("No prazo" ou "N dias" em vermelho), Vínculo (selo Ativo/Encerrado) e Instruções da empresa. Paginação de 20 no rodapé. A antiga 11ª coluna ("Instruções" repetida e sempre vazia) saiu. |

Item de menu único (sem abas), id de permissão `documentos` (`frontend/src/components/shell.tsx:82`, `:219`).

## Arquivos

Frontend
- `frontend/src/pages/NovasAbasPage.tsx` — `DocumentosPendentesPage`, `Vinculo`, `Atraso` e os auxiliares do arquivo (`lerFiltros`, `temFiltro`, `BuscaComIcone`, lista `documentos`). O mesmo arquivo também tem Consultar Modelos (Vagas) e Instituições.
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui.tsx`, `frontend/src/components/pagina.tsx` (`CabecalhoPagina`, `CampoFiltro`, `ResumoResultados`, `Alerta`)
- `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts` (`dateBr`, `textoPlano` para nome, empresa e instruções)

Backend
- Rota: `backend/src/routes/index.ts:714-717`
- Service: `backend/src/services/legado.service.ts:745-830` (`LegadoService.documentos`; instanciado direto na rota, `routes/index.ts:621`)
- Permissão: `backend/src/lib/paginas.ts:52`

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/documentos-pendentes?modalidade=&empresa=&documento=&candidato=&de=&ate=&page=&pageSize=20` | Lista paginada dos documentos pendentes; `meta.total` para paginação | `routes/index.ts:714` → `LegadoService.documentos` |

`pageSize` aceita 1 a 100 (padrão 20).

## Dados

Somente leitura, Postgres schema `dna_work` (cópia do Lightsail):
- `contratos_gerados` (cg) — documento gerado; filtros `status <> '3'` e `devolvido = '0'` ou nulo. Datas `data`, `datainicio`, `datafim`.
- `contratos_diversos` (cd) — tipo do documento: `nome`, `tipo = 'Candidato'`, `devolucao = '1'`, `recisao`, `dias` (prazo).
- `candidato` (nome), `conratacaovaga` (casada por vaga + candidato; `status`, `datainicio`, `data_demicao`), `vaga`, `empresa` (`razao_social`, `nome_fantasia`, `instrucao`), `modalidade_vaga` (descrição), `assinatura_digital` (se existir linha → "Digital", senão "Manual").

Nada é gravado. Nenhum serviço externo.

## Regras e comportamentos importantes

- **Pesquisar sempre tem efeito:** com os mesmos filtros, recarrega a lista (`refetch`, ou a chave `rodada` no Financeiro); o botão mostra "Pesquisando…" com ícone girando enquanto carrega. Todo botão do sistema afunda e muda o tom ao ser pressionado (`index.css`, `.app-canvas button:active`).
- Vencimento (`legado.service.ts:773-781`): documento de rescisão com vínculo encerrado → `data_demicao`; outro de rescisão → `cg.datafim`; se `cg.data` estiver em `AAAA/MM/DD` e `cd.dias` for número → `data + dias`; senão `cg.datafim`.
- Dias de atraso são calculados em JavaScript (`:819-829`): diferença entre hoje (UTC) e o vencimento, só quando o vencimento é anterior a hoje; senão 0.
- Status: vínculo `1` → "Ativo", `2` → "Encerrado", outro valor aparece cru.
- Filtros (`:753-771`): "Todos" é ignorado em Modalidade e Documento. Modalidade compara com `ILIKE` **sem `%`** (igualdade sem diferenciar maiúsculas) com `modalidade_vaga.descricao`; Documento, Empresa (razão social ou fantasia) e Candidato usam `%texto%`. Datas convertidas de `AAAA-MM-DD` para `AAAA/MM/DD` e comparadas como texto.
- Ordem: vencimento (nulos no fim), depois nome.
- Os filtros só valem ao clicar Pesquisar (formulário não controlado); a página volta para 1. Filtros e página não ficam na URL. "Limpar filtros" (aparece quando há filtro além de "Todos") zera a busca e remonta o formulário (`key={versao}`).
- Modalidade e Documento continuam mandando "Todos" quando nada é escolhido (o rótulo da modalidade mostra "Todas"; o `value` é "Todos"). "Pessoa jurídica" aparece com acento, mas o `value` enviado continua "Pessoa Juridica".

## Cuidados ao mudar

- **A confirmar no banco:** o `WHERE` usa o nome `vencimento` (`:762-763`), mas o `CASE` de vencimento é só um apelido no `SELECT`, e o texto do `WHERE` não interpola a expressão. Se nenhuma tabela do `FROM` tiver coluna `vencimento`, o Postgres rejeita a consulta inteira (mesmo sem filtro de data). Testar contra o banco antes de mexer.
- As opções de Modalidade ("CLT", "Estágio", "Pessoa Juridica") precisam bater exatamente com `modalidade_vaga.descricao`, porque não há `%`. Não confirmado contra os dados.
- A lista de documentos do filtro é fixa no frontend (`NovasAbasPage.tsx:68-92`); documento novo em `contratos_diversos` não aparece no seletor.
- `NovasAbasPage.tsx` é compartilhado com Vagas (Consultar Modelos) e Instituições; os auxiliares `lerFiltros`, `temFiltro` e `BuscaComIcone` são usados por mais de uma tela.
- A consulta de contagem repete o `GROUP BY` e as condições; ao mudar uma, mude as duas.
- O "hoje" do atraso é UTC (`toISOString`), pode diferir de São Paulo perto da meia-noite.

## Como testar

- Tela: abrir `/documentos-pendentes`, pesquisar sem filtro, depois com modalidade, documento, empresa, candidato e período; conferir paginação, a coluna Atraso e "Limpar filtros" (os campos voltam ao vazio).
- Testes automatizados para esta tela: não encontrado.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm run agentes:conferir`.
