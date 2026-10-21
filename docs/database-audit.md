# Auditoria do PostgreSQL — DNAWORK

Consulta somente leitura em 21/10/2026. Nenhum `INSERT`, `UPDATE`, `DELETE`, `ALTER` ou `DROP` foi executado na base atual. Contagens e códigos, sem nomes, CPF, e-mail ou endereço.

## Tabelas usadas pela V1

| Tabela | Papel | Chave |
| --- | --- | --- |
| `dna_work.candidato` | Cadastro da pessoa. 85.126 linhas. PK `id_candidato` varchar(36). | PK |
| `dna_work.empresa` | Cliente. 341 linhas. PK `id_empresa` varchar(36). | PK |
| `dna_work.vaga` | Vaga. 4.002 linhas. PK `id_vaga` varchar(36). | PK |
| `dna_work.conratacaovaga` | Contratação ligada à vaga. 1.529 linhas. PK `id_contratacao` integer. O nome com a grafia legada foi preservado. | PK, sem default |
| `dna_work.colaborador` | Registro operacional do vínculo. 360 linhas. | Sem chave primária |
| `dna_work.modalidade_vaga` | Modalidades reais. | PK `id` |

Não há foreign keys no schema `dna_work` (0 constraints `FOREIGN KEY`). Não há triggers nessas tabelas. A aplicação precisa validar os vínculos.

## Modalidades confirmadas

| id | descricao | Uso na V1 |
| --- | --- | --- |
| 1 | Estágio | Contratação permitida |
| 2 | CLT | Contratação permitida |
| 4 | Pessoa Juridica | Fora desta versão. A API recusa. |

A classificação usa o texto de `descricao`, não um enum inventado. `vaga.tipo_vaga` e `colaborador.tipo_vaga` apontam para esses ids: 2.908 vagas de estágio, 1.076 CLT e 18 PJ.

## Status confirmados por evidência

Contratação (`conratacaovaga.status`):

- `1`: 325 linhas, todas sem data de demissão. É o vínculo ativo.
- `2`: 1.204 linhas, 1.203 com data de demissão. É o vínculo encerrado.

Vaga, cruzada com a contratação:

- status `1` aparece nas 325 vagas que têm contrato ativo. O legado grava `vaga.status = 1` ao contratar.
- status `2` acompanha 1.169 contratos encerrados.
- Também existem vagas nos status `0` (109), `3` (20), `6` (1.427), `7` (91), `8` (535) e `9` (1). Os rótulos desses códigos não estão no banco e não foram presumidos.

Empresa: `0` (196) e `1` (145). O significado não está documentado na tabela.

Colaborador: `status_colaborador` `1` (248) e `0` (112). A V1 grava `1` no novo vínculo e `0` ao encerrar o registro que ela mesma criou.

## Datas, dinheiro e quantidade

- Datas de contratação, cadastro e abertura estão em `varchar` no formato `AAAA/MM/DD` (máscara `9999/99/99`). A API recebe e devolve `AAAA-MM-DD` e grava no formato legado.
- Salário de vaga é `varchar`. O formato mais comum é `999,99` ou `9999,99`. A API devolve número e grava com vírgula.
- Não existe coluna de quantidade de posições. `vaga.limcand` é outro conceito: 2.504 vazios e valores frequentes 10, 100, 20, 15. Não foi usado como capacidade.
- Cada uma das 1.529 contratações está em uma vaga diferente. O modelo antigo ocupa uma vaga por contratação. Várias posições na mesma vaga é regra nova.

## Integridade que impede índice único agora

- CPF: 352 grupos duplicados depois da normalização. 64.088 candidatos sem CPF. 6 com tamanho diferente de 11. Índice único quebraria a base. A API bloqueia CPF novo duplicado.
- CNPJ: 0 grupos duplicados. 3 empresas sem CNPJ. As demais têm 14 dígitos. Ainda não há índice próprio de CNPJ.
- `colaborador.id_colaborador`: 360 valores distintos, nenhum vazio, mas só índice comum. Sem PK.
- 320 dos 325 contratos ativos não têm par candidato+empresa em `colaborador`. 311 colaboradores não têm par correspondente. A V1 cria um colaborador novo por contratação e propõe `id_contratacao` para ligar o histórico, sem reescrever as linhas antigas.

## Geração de `id_contratacao`

- Tipo integer, `NOT NULL`, `column_default` nulo.
- `pg_get_serial_sequence` retornou nulo. Não existe sequence no schema.
- Mínimo 28, máximo 2.500, 1.529 linhas: há buracos. O legado MySQL usava autoincremento e omitia a coluna no `INSERT`.
- A migration `002` cria a sequence a partir do máximo atual. A API usa `nextval` e não `MAX(id) + 1`.

## O que a V1 não altera sozinha

As migrations em `database/migrations` estão propostas e não foram aplicadas. Enquanto `quantidade_posicoes`, a sequence, `colaborador.id_contratacao` e `api_idempotencia` não existirem, cadastro de vaga e contratação respondem `503 MIGRACAO_PENDENTE`.
