# Agente — Instituições

> Última revisão: 2026-11-12 (commit 5f1e2d0)

## Para que serve

Consulta as instituições de ensino (escolas e faculdades) cadastradas no sistema antigo, com situação do convênio, tipo de ensino e localização. A aba "Cadastrar" hoje é só o formulário visual: o botão Salvar não grava nada.

## Rotas e abas

| Rota | Componente | Arquivo | O que mostra |
| --- | --- | --- | --- |
| `/instituicoes` (menu "Consultar") | `ConsultarInstituicoesPage` | `frontend/src/pages/NovasAbasPage.tsx:342-389` | Filtros: Buscar (razão social, fantasia, CNPJ, telefone, e-mail), Tipo Ensino, Conveniada, Cidade, UF. Tabela: Conveniada, Início/Término do convênio, Tipo Ensino, Experiência (estrelas), CNPJ/INEP, Razão Social, Nome Fantasia, Bairro, Cidade, Estado. Paginação de 20. |
| `/instituicoes/nova` (menu "Cadastrar") | `CadastrarInstituicaoPage` | `frontend/src/pages/NovasAbasPage.tsx:391-441` | Formulário com tipo de ensino, tipo de instituição, CNPJ/INEP, IE/IM, mantenedora, razão social, fantasia, diretor, representante legal, contatos, endereço, latitude/longitude. Sem ligação com a API. |

Ids de permissão: `instituicoes` e `instituicoes-nova` (`frontend/src/components/shell.tsx:41-44`, `:72-73`).

## Arquivos

Frontend
- `frontend/src/pages/NovasAbasPage.tsx` — `ConsultarInstituicoesPage`, `CadastrarInstituicaoPage` e auxiliares compartilhados (`Screen`, `DataTable`, `ListingFooter`, `lerFiltros`, `Consulta`).
- `frontend/src/components/paginacao.tsx`, `frontend/src/components/ui.tsx`
- `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts` (`dateBr`, `formatCnpj`)

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

Nada é gravado. Nenhum serviço externo.

## Regras e comportamentos importantes

- Filtros (`legado.service.ts:882-889`): `q` com `%texto%` em razão social, fantasia, CNPJ, telefone e e-mail; Tipo Ensino por **igualdade exata** com `tipo_encino` ("Todos" ignora); Conveniada "Sim" → `convenio = '1'`, "Não"/"Nao" → `'0'` ou sem convênio ("Todas" ignora); Cidade e UF com `%texto%`.
- Ordem: `nome_fantasia` (nulos no fim), depois `razao_social`.
- Na tabela (`NovasAbasPage.tsx:383`): Conveniada mostra "Sim" só quando `convenio = "1"`; término vazio com convênio ativo aparece como "Indeterminada"; Experiência repete "★" pelo número em `parece`.
- Filtros só valem ao clicar Pesquisar; voltam para a página 1; não ficam na URL.
- `CadastrarInstituicaoPage`: campos sem estado e botão `type="button"` sem `onClick` — nada é enviado.

## Cuidados ao mudar

- As opções de Tipo Ensino ("Ensino Médio", "Ensino Superior", "Ensino Supletivo", "Ensino Técnico") precisam bater exatamente com os valores de `instituicao.tipo_encino`. Não confirmado contra os dados.
- Os nomes de coluna legados com erro (`id_instiduicao`, `id_intituicao`, `tipo_encino`, `parece`) são os reais; não "corrija" no SQL.
- `dna_work.instituicao` também alimenta a busca de escola do TCE e os signatários/dados de escola das rescisões. Mudanças de estrutura afetam Termos e Contratações.
- `NovasAbasPage.tsx` é compartilhado com Vagas (Consultar Modelos) e Documentos pendentes.
- Para fazer o Cadastrar funcionar seria preciso criar rota, validação e decidir onde gravar (Postgres `dna_work` é cópia do Lightsail); nada disso existe hoje.

## Como testar

- Tela: abrir `/instituicoes`, pesquisar sem filtro e com cada filtro (tipo de ensino, conveniada Sim/Não, cidade, UF); conferir paginação e as colunas de convênio. Abrir `/instituicoes/nova` e confirmar que Salvar não faz chamada.
- Testes automatizados para esta tela: não encontrado.
- Comandos: `npm run lint -w frontend`, `npm run lint -w backend`, `npm test -w backend`, `npm run agentes:conferir`.
