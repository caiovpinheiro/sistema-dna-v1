# Recibo de rescisão de estágio na página de Holerite — desenho curto

> Status: aguardando aprovação · Tamanho: mudança pequena

## Intenção
O financeiro precisa fechar o acerto de quem foi desligado do estágio. Hoje o Holerite só faz a folha mensal. O sistema deve calcular sozinho o acerto final e mostrar cada valor separado, mais o total, com um recibo em PDF.

## Regra de cálculo (definida pelo usuário)
- **Dias trabalhados** = bolsa ÷ 30 × dias trabalhados.
- **Férias proporcionais** = bolsa ÷ 12 × meses trabalhados.
- **Total** = soma dos dois.
- **Meses** contam a partir da data de início (nem sempre dia 1): meses fechados desde o início, **mais 1 mês se sobrar qualquer dia** (regra B escolhida pelo usuário).
- Exemplo do usuário: início 01/01/2026, desligamento 30/03/2026, bolsa R$ 1.300 → R$ 1.300,00 + R$ 325,00 = **R$ 1.625,00**.

### Escolhas minhas (a conferir)
- **Mês fechado:** de `início + n meses` até o dia anterior, inclusive. Início no dia 31 usa o último dia do mês mais curto.
- **Dias trabalhados** = dias da sobra depois do último mês fechado, contando os dois extremos, no máximo 30. Sem sobra, 0 dia. Fechou exatamente N meses → só férias proporcionais de N meses.
- **Quem entra:** contratação de estágio com `data_demicao` preenchida no mês escolhido e diferente da data de contratação (desistência não entra, igual ao Faturamento). Bolsa = `vaga.salario`.
- **Duplicidade:** a folha do mês do desligamento continua calculando a bolsa proporcional como hoje. Nesse mês, a folha mostra um aviso por estagiário desligado ("acerto no recibo de rescisão") para ninguém pagar duas vezes. Não mudo o cálculo da folha.

## Objetivos
- Opção "Rescisões" em `/financeiro/holerite`, com os filtros de empresa, mês e ano já existentes: lista de desligados no mês.
- Por linha: empresa, estagiário, início, desligamento, bolsa, dias trabalhados e valor, meses e férias proporcionais, total.
- PDF do recibo por estagiário (mesmo estilo do PDF do holerite).

## Fora do escopo
- CLT e TRCT (verbas rescisórias).
- Guardar o recibo em tabela, lançar acréscimos ou descontos, assinatura eletrônica.
- Mudar a folha mensal ou o contrato de rescisão de Contratações.

## Abordagens consideradas
1. **Calculado na hora, com PDF (escolhida pelo usuário).** Sem migração. O valor sempre sai da regra e dos dados da contratação. Contra: mudança futura da bolsa altera o recibo emitido de novo.
2. Calculado e gravado em `dna_work.rescisao_estagio`. Congela o valor, mas pede migração e mais telas.
3. Dentro de Contratações → Rescisão. Rejeitada: o pedido é na página de Holerite e a permissão é outra (`holerite`).

## Desenho técnico
- `backend/src/lib/holerite.ts`: `calcularRescisaoEstagio({ inicio, demissao, bolsa })` (função pura, retorna meses fechados, dias, meses, valores e total) e o PDF do recibo.
- `backend/src/services/holerite.service.ts`: `rescisoes(competencia, empresa?)` e `rescisaoPdf(idContratacao)`.
- Rotas em `routes/index.ts`: `GET /api/v1/holerite/rescisoes?empresa&mes&ano` e `GET /api/v1/holerite/rescisoes/:contratacao/pdf`. Já cobertas pela permissão `holerite`.
- Frontend (`FinanceiroPage.tsx`): abas "Folhas" e "Rescisões" na `GerarHoleritePage`. Aviso na `HoleriteFolhaPage`.
- Testes em `backend/test/holerite.test.ts`: o exemplo do usuário, início no meio do mês, sobra zero, início no dia 31, bolsa zero.
- Atualizar `docs/agentes/financeiro/agente.md` e rodar `npm run agentes:conferir`.

## Deixado para quem implementa
Layout exato do PDF e dos textos da tela, seguindo o padrão visual existente.
