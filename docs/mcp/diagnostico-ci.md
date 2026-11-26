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

CI do commit `62ddde3`: 390 testes, 385 passam, **2 falham** (exatamente os da causa 3).

### Causa 3 — investigação e correção (Fase 5)

Investigado antes de mudar qualquer expectativa:

| Fonte | O que diz |
|---|---|
| `backend/src/services/contratacao.service.ts` | Ao ocupar a última posição, grava `VAGA_STATUS_OCUPADA` (padrão `1`, `config.ts`/`.env.example`). "Trocar vaga" devolve a antiga para `aberta` (código 0) e marca a nova como ocupada. Só contrata em vaga `aberta`. |
| `backend/src/lib/vaga-status.ts` | Quatro status do sistema novo: aberta (0,3,4,5,9), pausada (8), **contratada (1)**, fechada (2,6,7). |
| `backend/src/services/presenters.ts` | `presentVaga` devolve `situacao = statusDaVaga(status)`. A função `vagaSituacao` (que devolvia `preenchida`) **não é usada em nenhum lugar** (código morto). |
| Banco | `dna_work.vaga.status` guarda o código do Lightsail; o código 1 é o "contratada". |
| Frontend | `STATUS_VAGA` (filtros e selo editável) só tem aberta, pausada, contratada, fechada. `preenchida` sobra apenas no mapa de rótulos (`situacaoLabel`) e no estilo do selo, sem origem na API. |
| Filtros e indicadores | `?situacao=` e a contagem por situação dos grupos usam os quatro status (`vaga.repository.ts`, `vaga-prioridade.test.ts` conta `contratada`). |
| Documentação | `docs/agentes/vagas/agente.md` (4 status, contratada = 1) e `docs/agentes/contratacoes/agente.md` ("status vira `VAGA_STATUS_OCUPADA` quando a última posição é preenchida"). |

Conclusão: **`contratada` é a regra vigente**; os dois testes estavam desatualizados (escritos para o rótulo antigo `preenchida`). Não há inconsistência de regra de negócio. As duas expectativas foram trocadas para `"contratada"`, com comentário apontando esta justificativa. Nada mais mudou no teste.

Observação (não alterado): `vagaSituacao` em `presenters.ts` e o rótulo `preenchida` no frontend são resíduos do vocabulário antigo; podem ser removidos numa limpeza separada.

## Os 22 testes locais (`hookFailed`)

Falham só aqui porque o `embedded-postgres` não inicia como root. Na CI rodam normalmente. Para rodar localmente use um usuário não root ou `MCP_TEST_DATABASE_URL`.
