# Diagnóstico das falhas da CI (base × Fase 2B × Fase 3)

> Última revisão: 2026-11-26. Workflow: `.github/workflows/diagnostico-testes.yml` (roda a suíte do monólito em cada commit, mesmas condições: Node 22, Postgres 16, `npm ci`; nunca implanta).

## Comparação

| Commit | Testes | Passam | Falham | Falhas |
|---|---|---|---|---|
| Base `8f60e80` (antes do MCP) | 226 | 213 | 10 | as mesmas 10 |
| Fase 2B `1fed368` | 308 | 295 | 10 | as mesmas 10 |
| Fase 3 `3c2e32c` | 362 | 349 | 10 | as mesmas 10 |

**Conclusão: as 10 falhas são pré-existentes. O MCP não introduziu nenhuma regressão** (os testes só aumentam, as falhas não mudam).

As 10 (todas em `escopo.test.ts` e `vaga-prioridade.test.ts`): cadastra candidato e bloqueia CPF duplicado; cria vagas semelhantes; contrata até o limite; duas contratações concorrentes; troca a vaga de uma contratação; encerra contratação; aba Rescisão; pesquisa candidatos e empresas; gera acesso ao portal; pesquisa inteligente.

## Causas

1. **Fixture de teste atrasada** (8 testes): `database/schema/local-dev.sql` não tem colunas e tabelas que o código usa e que em produção vêm do banco legado ou de migrations (`dna_work.vaga.km` e outras, `dna_work.candidato.atendimento`, `public.empresa`, colunas de `usuario_empresa`, `vinculo_empresa_usuario`).
2. **Localidade do Postgres embutido** (1 teste, "pesquisa inteligente"): o `embedded-postgres` nasce com localidade C, e `lower()` não trata `Ã`/`É`; produção usa UTF-8.
3. **Expectativa antiga** (2 testes: "contrata até o limite" e "troca a vaga"): esperam `situacao === "preenchida"`, mas a API devolve `"contratada"` (vocabulário de quatro situações: aberta, pausada, contratada, fechada, já usado em `vaga-prioridade.test.ts`).

## Correção isolada (aplicada só ao ambiente de teste)

`backend/test/esquema-legado.ts` completa o banco de teste (causa 1) e fornece `INICIAR_UTF8` (causa 2), usados por `escopo.test.ts` e `vaga-prioridade.test.ts`. Nenhuma regra de negócio, asserção ou critério mudou. Resultado na CI: **10 → 3** (verificado também localmente com Postgres 16: as mesmas 2 que sobram).

Sobram 2 (causa 3). Proposta, **aguardando decisão**: trocar a expectativa `"preenchida"` por `"contratada"` nas duas asserções (linhas de `escopo.test.ts`), pois o código já devolve o vocabulário novo; é decisão de produto confirmar que `contratada` é o valor correto quando todas as posições estão ocupadas. Não foi alterado para não ajustar critério só para passar.

## Os 22 testes locais (`hookFailed`)

Falham só aqui porque o `embedded-postgres` não inicia como root. Na CI rodam normalmente. Para rodar localmente use um usuário não root ou `MCP_TEST_DATABASE_URL`.
