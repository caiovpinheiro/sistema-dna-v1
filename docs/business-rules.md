# Regras de negócio — DNAWORK V1

## Empresas

Uma empresa possui várias vagas. Cargos iguais em vagas com IDs diferentes são registros independentes. A vaga só é criada se a empresa existir. Empresa é localizada por ID, CNPJ, razão social ou nome fantasia. CNPJ já cadastrado retorna `409` e não cria outra empresa. O campo `matriz` só é gravado quando o ID informado existe. Atualização parcial não apaga campos omitidos.

## Candidatos

O candidato existe sem empresa. CPF normalizado (somente dígitos, com dígitos verificadores) não pode se repetir. Nova contratação reutiliza o cadastro. Encerrar um vínculo não apaga o candidato. O formulário guarda dados de estágio e de CLT no mesmo cadastro. CPF, CNPJ, telefone e CEP são normalizados na validação e na pesquisa.

## Vagas e posições

Toda contratação exige `id_vaga` existente. A empresa contratante é a da vaga. Um `id_empresa` diferente enviado pelo cliente gera `409 EMPRESA_DIVERGENTE`.

A capacidade fica em `vaga.quantidade_posicoes`. Posição ocupada é contratação com status ativo (`1`). Disponíveis = quantidade − ocupadas. A vaga não aceita redução abaixo das posições ocupadas. Com a quantidade preenchida, a situação derivada é `preenchida` e a API grava `vaga.status = 1`, o mesmo código que o legado usa ao ocupar a vaga. Encerrar um vínculo libera a posição e não apaga o histórico. A vaga não é fechada automaticamente, para permitir reposição enquanto o status administrativo não estiver na lista bloqueada.

Status bloqueado para nova contratação, por padrão: `2`. Os demais códigos continuam contratáveis se houver posição livre. Isso está em `VAGA_STATUS_BLOQUEADAS`.

## Contratação

Fluxo, numa transação:

1. Reserva a chave `Idempotency-Key`.
2. Bloqueia o candidato com `pg_advisory_xact_lock`.
3. Bloqueia a vaga com `SELECT … FOR UPDATE`.
4. Confere empresa, modalidade, candidato, duplicidade e quantidade.
5. Insere `conratacaovaga` com `nextval`.
6. Insere `colaborador` novo, ligado por `id_contratacao`.
7. Marca `candidato.colaborador = 1` e `candidato.id_empresa` com a empresa da vaga.
8. Se a vaga ficou cheia, grava status ocupada.
9. Devolve os IDs. Qualquer falha faz `ROLLBACK`.

CLT e estágio vêm de `modalidade_vaga.descricao`. Pessoa jurídica é recusada nesta versão. Não há mensagem, cobrança nem contrato automático.

`ALLOW_MULTIPLE_ACTIVE_LINKS=false` impede dois vínculos ativos do mesmo candidato, inclusive em empresas diferentes. Na base atual existem 0 candidatos com mais de um status `1`. A trava fica até o negócio decidir.

## Datas e valores

A API fala ISO `AAAA-MM-DD`. O banco legado guarda `AAAA/MM/DD`. Salário novo é gravado com vírgula decimal, como a maior parte das vagas atuais.

## LGPD

A V1 é um sistema administrativo autenticado. CPF, dados bancários e Pix só aparecem para o administrador autenticado e não são escritos em log. Senha administrativa usa Argon2id. Não há exclusão em massa. Retenção: o histórico de contratação permanece porque é o registro do vínculo; exclusão de candidato não faz parte desta versão. Dados de produção não entram em teste, fixture nem repositório.
