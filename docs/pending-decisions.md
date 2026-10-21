# Decisões em aberto

Itens que a V1 tratou de forma conservadora. Nenhum exige parar o desenvolvimento local.

## Precisam de confirmação do negócio

1. **Vínculo simultâneo.** Hoje é bloqueado. Não há caso ativo na base. Confirmar se a mesma pessoa pode estar ativa em duas empresas.
2. **Rótulos dos status de vaga** `0`, `3`, `6`, `7`, `8` e `9`. A V1 só trata `2` como encerrada e `1` como ocupada, porque isso foi observado no cruzamento com as contratações.
3. **Status de empresa** `0` e `1`. A interface mostra o número. O cadastro novo grava `1`.
4. **Fechar a vaga ao encerrar a única pessoa.** O legado, de uma posição, levava a vaga ao status `2`. A V1 libera a posição e mantém a vaga contratável, para reposição. Se o encerramento também deve encerrar a vaga, isso precisa ser definido.
5. **Candidato sem CPF.** 64.088 registros antigos não têm CPF. O cadastro novo exige CPF válido.
6. **Backfill de `quantidade_posicoes`.** A sugestão comentada em `005` iguala a quantidade aos contratos ativos, deixando essas vagas preenchidas. Vagas sem contrato ficam `NULL` e não aceitam contratação até alguém definir a quantidade. `limcand` não deve ser copiado.

## Migrations

O deploy executa `prisma migrate deploy` antes de subir a API. A migration `20261021183000_v1_foundation` aplica os arquivos `001` a `004`: coluna de posições, sequence de contratação, vínculo em `colaborador` e tabela de idempotência. Ela não apaga dados.

O `005_backfill_quantidade_posicoes.sql` continua de fora. O `UPDATE` que preencheria as vagas antigas segue comentado.

Não usar `prisma db push` nem `prisma migrate dev` na base atual. O `schema.prisma` não descreve as tabelas legadas.

## Fora desta versão

Faturamento, folha, ponto, WhatsApp, assinatura, TCE, avaliação, NPS e comunicação automática. Pessoa jurídica não é contratada pela API.

## Segurança operacional

O token do GitHub e a senha do banco foram colados na conversa. Eles não estão no repositório. Os dois devem ser revogados e trocados antes de qualquer publicação.
