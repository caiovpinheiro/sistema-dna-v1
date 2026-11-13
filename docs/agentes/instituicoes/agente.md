# Agente — Instituições

> Última revisão: 2026-11-13 (commit "Corrige faturamento Todas, nomes com &amp;, rescisão pela ficha e cadastro de instituição")

## Para que serve

Consulta as instituições de ensino (escolas e faculdades) cadastradas no sistema antigo, com situação do convênio, tipo de ensino e localização. A aba "Cadastrar" grava uma instituição nova em `dna_work.instituicao`.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/instituicoes` (menu "Consultar") | `ConsultarInstituicoesPage` | `frontend/src/pages/NovasAbasPage.tsx:564-695` | Título "Instituições de ensino" (`CabecalhoPagina`). Filtros em `CampoFiltro`: Buscar (razão social, fantasia, CNPJ, telefone, e-mail; ícone de busca), Tipo de ensino, Convênio (Todas/Conveniadas/Sem convênio), Cidade, UF e botão Pesquisar. `ResumoResultados` com total e "Limpar filtros". Tabela `data-table` (blocos em telas estreitas): Instituição (fantasia, razão social embaixo), CNPJ/INEP, Tipo de ensino, Convênio (selo Conveniada/Sem convênio + período), Experiência (estrelas), Local (cidade/UF, bairro embaixo). Paginação de 20 no rodapé. |
| `/instituicoes/nova` (menu "Cadastrar") | `CadastrarInstituicaoPage` | `frontend/src/pages/NovasAbasPage.tsx:697-770` | "Nova instituição de ensino". Seções Instituição, Direção e representante legal, Contato e Endereço (grade de 6 colunas) e "Salvar instituição" no fim (só com razão social de 3+ letras). Ao salvar, tela "Instituição cadastrada" com aviso dos campos que não tinham coluna no banco, "Ver instituições" e "Cadastrar outra". |

Ids de permissão: `instituicoes` e `instituicoes-nova` (`frontend/src/components/shell.tsx:41-44`, `:72-73`).

## Arquivos

Frontend
- `frontend/src/pages/NovasAbasPage.tsx` — `ConsultarInstituicoesPage`, `CadastrarInstituicaoPage`, `Convenio`, `Experiencia` e auxiliares compartilhados do arquivo (`lerFiltros`, `temFiltro`, `Secao`, `Grade`, `Celula`, `BuscaComIcone`).
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui.tsx`, `frontend/src/components/pagina.tsx` (`CabecalhoPagina`, `CampoFiltro`, `ResumoResultados`, `Alerta`)
- `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts` (`dateBr`, `formatCnpj`, `textoPlano`)

Backend
- Rota: `backend/src/routes/index.ts:727-730`
- Service: `backend/src/services/legado.service.ts:875-914` (`LegadoService.instituicoes`)
- Permissão: `backend/src/lib/paginas.ts:54`
- Outros leitores da mesma tabela (fora desta seção): `backend/src/lib/escolas.ts` (busca de escola no gerador de TCE), `backend/src/services/termo.service.ts` e `contratacao.service.ts` (escola/diretor em rescisões).

## API usada

| Método | Caminho | O que faz | Onde está no backend |
| --- | --- | --- | --- |
| GET | `/api/v1/instituicoes?q=&ensino=&conveniada=&cidade=&uf=&page=&pageSize=20` | Lista paginada com `meta.total` | `routes/index.ts:727` → `LegadoService.instituicoes` |

Cadastro de instituição (POST/PATCH): não encontrado no backend.

## Dados

Somente leitura, Postgres schema `dna_work` (cópia do Lightsail):
- `instituicao` (i): `id_instiduicao` (nome legado com erro de digitação), `razao_social`, `nome_fantasia`, `cnpj`, `telefone`, `email`, `tipo_encino` (sic), `parece` (nota, mostrada como estrelas), `bairro`, `cidade`, `uf`.
- `instituicao_convenio` (c): o convênio mais recente por instituição (`ORDER BY id_convenio DESC LIMIT 1`, via `LEFT JOIN LATERAL` em `c.id_intituicao = i.id_instiduicao`): `convenio`, `data_inicio`, `data_termino`.

Gravação (só em "Cadastrar"): `INSERT` em `dna_work.instituicao` (`backend/src/services/instituicao.service.ts`). Nenhum serviço externo; o MySQL do sistema antigo não é tocado.

## Regras e comportamentos importantes

- Filtros (`legado.service.ts:882-889`): `q` com `%texto%` em razão social, fantasia, CNPJ, telefone e e-mail; Tipo Ensino por **igualdade exata** com `tipo_encino` ("Todos" ignora); Conveniada "Sim" → `convenio = '1'`, "Não"/"Nao" → `'0'` ou sem convênio ("Todas" ignora); Cidade e UF com `%texto%`.
- Ordem: `nome_fantasia` (nulos no fim), depois `razao_social`.
- Na tabela (`Convenio` e `Experiencia`, `NovasAbasPage.tsx:546-562`): o selo "Conveniada" aparece só quando `convenio = "1"` (senão "Sem convênio"); término vazio com convênio ativo aparece como "prazo indeterminado"; Experiência repete "★" pelo número em `parece` ("—" quando 0 ou vazio).
- Filtros só valem ao clicar Pesquisar; voltam para a página 1; não ficam na URL. Os selects mandam "Todos"/"Todas" como antes (o backend ignora). "Limpar filtros" zera a busca e remonta o formulário (`key={versao}`).
- Cadastrar (`POST /api/v1/instituicoes/nova`, só com a página `instituicoes-nova`; listar aceita `instituicoes` ou `instituicoes-nova`, regra em `lib/paginas.ts`):
  - Lê as colunas da tabela em `information_schema` e grava cada campo na primeira coluna que existir da lista `COLUNAS_DO_CAMPO` (ex.: tipo de ensino → `tipo_encino`; diretor → `diretor` ou `responsavel`). Campo preenchido sem coluna volta em `ignorados` e a tela avisa — nada some em silêncio.
  - Id: usa o padrão da coluna `id_instiduicao`; sem padrão, `max + 1` se for número ou UUID se for texto, com a tabela travada (`LOCK … SHARE ROW EXCLUSIVE`) na transação.
  - CNPJ/INEP repetido (comparado só pelos dígitos) → 409 `INSTITUICAO_DUPLICADA`. Coluna obrigatória sem valor → 422 `CAMPO_OBRIGATORIO`; formato/tamanho → 422.
  - Nomes perdem entidades HTML (`&amp;` → `&`); CEP, CPFs e telefones gravados só com dígitos; UF em maiúsculas; latitude/longitude aceitam vírgula.
  - A instituição criada aparece na consulta e na busca de escola do TCE (`lib/escolas.ts` lê a mesma tabela). Ainda não cria convênio (`instituicao_convenio`).

## Cuidados ao mudar

- As opções de Tipo Ensino ("Ensino Médio", "Ensino Superior", "Ensino Supletivo", "Ensino Técnico") precisam bater exatamente com os valores de `instituicao.tipo_encino`. Não confirmado contra os dados.
- Os nomes de coluna legados com erro (`id_instiduicao`, `id_intituicao`, `tipo_encino`, `parece`) são os reais; não "corrija" no SQL.
- `dna_work.instituicao` também alimenta a busca de escola do TCE e os signatários/dados de escola das rescisões. Mudanças de estrutura afetam Termos e Contratações.
- `NovasAbasPage.tsx` é compartilhado com Vagas (Consultar Modelos) e Documentos pendentes.
- Os `value` das opções de Tipo de ensino e Convênio ("Ensino Médio", "Sim", "Não"…) são os que o backend compara; só o texto mostrado mudou. Não troque os `value`.
- Para fazer o Cadastrar funcionar seria preciso criar rota, validação e decidir onde gravar (Postgres `dna_work` é cópia do Lightsail); nada disso existe hoje.

## Como testar

- Tela: abrir `/instituicoes`, pesquisar sem filtro e com cada filtro (tipo de ensino, convênio, cidade, UF); conferir paginação, as colunas de convênio e "Limpar filtros". Abrir `/instituicoes/nova`, conferir o aviso e confirmar que Salvar não faz chamada.
- Testes automatizados para esta tela: não encontrado.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm run agentes:conferir`.
- Teste: `backend/test/instituicao.test.ts` (mapeamento campo → coluna, limpeza dos valores e permissão da rota).
