# Decisões em aberto

Itens que a V1 tratou de forma conservadora. Nenhum exige parar o desenvolvimento local. A aplicação na base atual depende da aprovação das migrations.

## Precisam de confirmação do negócio

1. **Vínculo simultâneo.** Hoje é bloqueado. Não há caso ativo na base. Confirmar se a mesma pessoa pode estar ativa em duas empresas.
2. **Rótulos dos status de vaga** `0`, `3`, `6`, `7`, `8` e `9`. A V1 só trata `2` como encerrada e `1` como ocupada, porque isso foi observado no cruzamento com as contratações.
3. **Status de empresa** `0` e `1`. A interface mostra o número. O cadastro novo grava `1`.
4. **Fechar a vaga ao encerrar a única pessoa.** O legado, de uma posição, levava a vaga ao status `2`. A V1 libera a posição e mantém a vaga contratável, para reposição. Se o encerramento também deve encerrar a vaga, isso precisa ser definido.
5. **Candidato sem CPF.** 64.088 registros antigos não têm CPF. O cadastro novo exige CPF válido.
6. **Backfill de `quantidade_posicoes`.** A sugestão comentada em `005` iguala a quantidade aos contratos ativos, deixando essas vagas preenchidas. Vagas sem contrato ficam `NULL` e não aceitam contratação até alguém definir a quantidade. `limcand` não deve ser copiado.

## Migrations ainda não aplicadas

Não executar na base atual sem autorização:

- `001_vaga_quantidade_posicoes.sql`
- `002_conratacaovaga_sequence.sql`
- `003_colaborador_id_contratacao.sql`
- `004_api_idempotencia.sql`
- `005_backfill_quantidade_posicoes.sql` contém o diagnóstico e um `UPDATE` comentado.

## Fora desta versão

Faturamento, folha, ponto, WhatsApp, assinatura, TCE, avaliação, NPS e comunicação automática. Pessoa jurídica não é contratada pela API.

## Segurança operacional

O token do GitHub e a senha do banco foram colados na conversa. Eles não estão no repositório. Os dois devem ser revogados e trocados antes de qualquer publicação.
