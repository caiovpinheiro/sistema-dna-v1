# Recibo de rescisão de estágio no Holerite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listar os estagiários desligados no mês em `/financeiro/holerite`, calcular dias trabalhados e férias proporcionais e gerar o recibo em PDF.

**Architecture:** Função pura de cálculo em `backend/src/lib/holerite.ts` + PDF no mesmo arquivo; `HoleriteService` ganha `rescisoes` e `rescisaoPdf`; duas rotas GET sob `/api/v1/holerite` (já cobertas pela permissão `holerite`); a `GerarHoleritePage` ganha a aba "Rescisões". Nada é gravado no banco.

**Tech Stack:** Fastify + zod + pg + pdf-lib (backend, testes `node:test`), React + react-query (frontend).

**Spec:** `docs/superpowers/specs/2026-11-26-rescisao-estagio-design.md`

## Global Constraints

- Dias trabalhados = bolsa ÷ 30 × dias da sobra; férias proporcionais = bolsa ÷ 12 × meses; total = soma. Valores arredondados em centavos (`centavos`).
- Meses = meses fechados desde o início + 1 se sobrar qualquer dia (regra B). Mês fechado: de `início + n meses` até o dia anterior, inclusive. Início no dia 31 usa o último dia do mês mais curto.
- Dias da sobra: contando os dois extremos, no máximo 30; sem sobra, 0.
- Só estágio (`classifyRegime(modalidade) === "estagio"`) com `data_demicao` no mês e diferente de `datainicio` (desistência fora). Bolsa = `vaga.salario`.
- Não gravar nada no banco, sem migração. Não mudar o cálculo da folha mensal.
- Texto da interface em português. Sem dados pessoais nos `agente.md`.
- CLAUDE.md: atualizar `docs/agentes/financeiro/agente.md` (inclusive `> Última revisão`) no mesmo commit da mudança de página e rodar `npm run agentes:conferir` antes de commitar.

## Review Focus

- Início no dia 31 e desligamento em fevereiro/meses curtos: não pode dar data inválida nem erro.
- Desligamento antes do início ou igual ao início (desistência): sem recibo, nunca valor negativo.
- Bolsa vazia ou 0 na vaga: recibo com R$ 0,00, sem NaN.
- Fechou exatamente N meses (sem sobra): dias trabalhados 0 e férias de N meses.
- Sobra de 31 dias (mês de 31 dias): dias trabalhados limitado a 30.

---

### Task 1: Cálculo da rescisão

**Files:**
- Modify: `backend/src/lib/holerite.ts` (acrescentar no fim da parte de cálculo, antes de `MESES`)
- Test: `backend/test/holerite.test.ts`

**Interfaces:**
- Produces: `type CalculoRescisao = { bolsa_base: number; meses_fechados: number; dias_trabalhados: number; meses: number; valor_dias: number; valor_ferias: number; total: number }` e `calcularRescisaoEstagio(entrada: { inicio: string | null; demissao: string | null; bolsa_base: number }): CalculoRescisao | null` (datas `AAAA-MM-DD`; `null` quando falta data, o desligamento é anterior ao início ou é a própria data de início).

- [ ] **Step 1: Write the failing tests** em `backend/test/holerite.test.ts`, import `calcularRescisaoEstagio`:
  - `test("rescisão: exemplo do usuário")`: `calcularRescisaoEstagio({ inicio: "2026-01-01", demissao: "2026-03-30", bolsa_base: 1300 })` → `meses_fechados 2`, `dias_trabalhados 30`, `meses 3`, `valor_dias 1300`, `valor_ferias 325`, `total 1625`.
  - `test("rescisão: início no meio do mês")`: `2026-01-15` → `2026-03-30` com 1200: `meses_fechados 2`, `dias_trabalhados 16`, `meses 3`, `valor_dias 640`, `valor_ferias 300`, `total 940`.
  - `test("rescisão: meses exatos, sem sobra")`: `2026-01-15` → `2026-03-14` com 1200: `meses_fechados 2`, `dias_trabalhados 0`, `meses 2`, `valor_dias 0`, `valor_ferias 200`.
  - `test("rescisão: sobra de 31 dias fica em 30")`: `2026-01-01` → `2026-03-31`... (fecha 3 meses, sem sobra → dias 0, meses 3) e `2026-02-01` → `2026-03-31` com 1200 (n=1... confirme pelo cálculo: fecha fev e mar → `meses_fechados 2`, dias 0). Para pinar o limite, use `2026-03-31` → `2026-05-31` com 1200 (início no dia 31): `meses_fechados 1`, `dias_trabalhados` ≤ 30.
  - `test("rescisão: início no dia 31 e fevereiro")`: `2026-01-31` → `2026-03-10` não lança erro e `meses_fechados 1`.
  - `test("rescisão: sem cálculo")`: desligamento igual ao início, anterior ao início e datas `null` → `null`; bolsa 0 → `total 0`.

- [ ] **Step 2: Run** `npm test -w backend -- --test-name-pattern="rescisão"` → FAIL (função não definida).

- [ ] **Step 3: Implement** `calcularRescisaoEstagio` e `CalculoRescisao` em `backend/src/lib/holerite.ts`. Abordagem: função auxiliar interna que soma N meses a uma data ISO com corte no último dia do mês (`Date.UTC`); `meses_fechados` = maior n com `somaMeses(inicio, n) − 1 dia ≤ demissao`; sobra = dias de `somaMeses(inicio, n)` até `demissao` inclusive, se positivo, limitado a 30; `meses = meses_fechados + (sobra > 0 ? 1 : 0)`.

- [ ] **Step 4: Run** o mesmo comando → PASS.

- [ ] **Step 5: Commit** `git add backend/src/lib/holerite.ts backend/test/holerite.test.ts && git commit -m "feat(holerite): cálculo da rescisão de estágio"`

### Task 2: PDF do recibo

**Files:**
- Modify: `backend/src/lib/holerite.ts`
- Test: `backend/test/holerite.test.ts`

**Interfaces:**
- Consumes: `CalculoRescisao` (Task 1).
- Produces: `type RescisaoPdf = { empresa: { razao_social: string; cnpj: string }; estagiario: { nome: string; cpf: string; cargo: string; inicio: string | null; demissao: string | null }; calculo: CalculoRescisao }` e `gerarRecibosRescisaoPdf(lista: RescisaoPdf[]): Promise<Uint8Array>` (uma página A4 por recibo, no estilo de `gerarHoleritesPdf`, reaproveitando `texto`, `direita`, `caber`, `dataBr`, `real`).

- [ ] **Step 1: Write the failing test** `test("recibo de rescisão em PDF")`: gera um recibo com o exemplo do usuário e outro, abre com `PDFDocument.load` e confere `getPageCount() === 2`.
- [ ] **Step 2: Run** `npm test -w backend -- --test-name-pattern="recibo de rescisão"` → FAIL.
- [ ] **Step 3: Implement** `gerarRecibosRescisaoPdf` com: cabeçalho "Recibo de rescisão de estágio", dados da concedente e do estagiário, início e desligamento, tabela com duas linhas separadas ("Dias trabalhados" com referência "N dias", "Férias proporcionais" com referência "N/12") e a linha de total, texto de quitação e linhas de assinatura. Sem INSS/IRRF/FGTS (mesma nota legal do holerite).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(holerite): PDF do recibo de rescisão"`

### Task 3: Service e rotas

**Files:**
- Modify: `backend/src/services/holerite.service.ts`, `backend/src/routes/index.ts` (junto das rotas `/api/v1/holerite/empresas`, ~linha 898)

**Interfaces:**
- Consumes: `calcularRescisaoEstagio`, `gerarRecibosRescisaoPdf` (Tasks 1 e 2).
- Produces: `HoleriteService.rescisoes(competencia: string, empresa?: string): Promise<{ competencia: string; itens: ItemRescisao[]; total: number }>` com `ItemRescisao = { id_contratacao: number; id_empresa: string; empresa: string; cnpj: string; nome: string; cpf: string; cargo: string; inicio: string; demissao: string; calculo: CalculoRescisao }`; `HoleriteService.rescisaoPdf(idContratacao: number): Promise<{ bytes: Uint8Array; arquivo: string }>` (404 `SEM_RESCISAO` se não for desligamento de estágio válido).
- Rotas: `GET /api/v1/holerite/rescisoes?competencia=AAAA-MM&empresa=` e `GET /api/v1/holerite/rescisoes/:contratacao/pdf`.

- [ ] **Step 1:** Em `rescisoes`, consultar `dna_work.conratacaovaga cv JOIN vaga v JOIN empresa e LEFT JOIN modalidade_vaga m LEFT JOIN candidato c` como em `folha`, filtrando `data_demicao` por prefixo `AAAA/MM` (texto `AAAA/MM/DD`) e a empresa pelas mesmas palavras da lista de `LegadoService.holerite` (`condicaoPorPalavras` de `lib/busca-texto.ts`). Descartar fora do estágio, sem início, desistência (demissão = início) e quando `calcularRescisaoEstagio` devolver `null`. Ordenar por empresa e nome.
- [ ] **Step 2:** Implementar `rescisaoPdf` reaproveitando a mesma consulta por `id_contratacao`; nome do arquivo `rescisao-<nome-sem-acento>.pdf` como em `pdf`.
- [ ] **Step 3:** Registrar as duas rotas com `competenciaSchema`, `empresa: z.string().optional()` e `contratacao: z.coerce.number().int().positive()`; o PDF responde como a rota de holerite (`inline`).
- [ ] **Step 4: Verify** `npm run lint -w backend && npm run build -w backend` (ou o script de tipos do backend) → sem erros; `npm test -w backend` → todos passam.
- [ ] **Step 5: Commit** `git commit -am "feat(holerite): lista e PDF de rescisões de estágio"`

### Task 4: Tela, aviso na folha e documentação

**Files:**
- Modify: `frontend/src/pages/FinanceiroPage.tsx` (`GerarHoleritePage`), `frontend/src/pages/HoleriteFolhaPage.tsx` (~linha 169), `docs/agentes/financeiro/agente.md`

**Interfaces:**
- Consumes: as rotas da Task 3.

- [ ] **Step 1:** `GerarHoleritePage`: duas abas, "Folhas" (tela atual) e "Rescisões", mantendo os filtros de empresa, mês e ano e o botão Pesquisar. A aba "Rescisões" busca `GET /api/v1/holerite/rescisoes?competencia=AAAA-MM&empresa=` e mostra tabela (`.data-table` em `Card`, `Skeleton`, `Alerta`, `Empty` para "nenhuma rescisão no mês") com empresa, estagiário, início, desligamento, bolsa, dias e valor, meses e valor das férias, total e botão "PDF" (abre `/api/v1/holerite/rescisoes/:id/pdf`). Rodapé com o total do mês.
- [ ] **Step 2:** `HoleriteFolhaPage`: quando `item.demissao` cai na competência, mostrar sob o nome "Desligado em dd/mm: o acerto sai no recibo de rescisão" (sem mudar valores).
- [ ] **Step 3:** Atualizar `docs/agentes/financeiro/agente.md` (rotas e abas, API usada, regras da rescisão, cuidados, como testar, `> Última revisão`) e rodar `npm run agentes:conferir` → passa.
- [ ] **Step 4: Verify** `npm run lint -w frontend` e o build do frontend → sem erros; abrir a tela com o app local (skill `run`) e conferir a aba, o PDF e o aviso, se houver banco disponível; se não houver, dizer que a conferência visual não foi feita.
- [ ] **Step 5: Commit** `git commit -am "feat(holerite): aba Rescisões, aviso na folha e documentação"` e `git push -u origin claude/dazzling-albattani-80vfa3`.
