-- DNAWORK V1 — PROPOSTA DE ANÁLISE. Não executar o UPDATE sem aprovação.
-- Diagnóstico: todas as 1529 contratações atuais estão em vagas distintas
-- (1 vínculo por vaga). limcand NÃO é quantidade de posições.
--
-- Estratégia segura sugerida, ainda comentada:
-- vagas com contrato ativo recebem quantidade igual ao número de ativos,
-- ficando preenchidas, nunca acima da capacidade.
-- Vagas sem contrato ativo permanecem NULL até alguém definir a quantidade.
-- Confirmar o status ativo (hoje 1) antes de rodar.

-- SOMENTE LEITURA
SELECT v.id_vaga,
       v.status,
       v.limcand,
       count(c.id_contratacao) FILTER (WHERE c.status = 1) AS ativos
FROM dna_work.vaga v
LEFT JOIN dna_work.conratacaovaga c ON c.id_vaga = v.id_vaga
GROUP BY v.id_vaga, v.status, v.limcand
ORDER BY ativos DESC;

-- UPDATE NÃO APROVADO
-- UPDATE dna_work.vaga v
-- SET quantidade_posicoes = ativos.qtd
-- FROM (
--   SELECT id_vaga, count(*) AS qtd
--   FROM dna_work.conratacaovaga
--   WHERE status = 1
--   GROUP BY id_vaga
-- ) ativos
-- WHERE v.id_vaga = ativos.id_vaga
--   AND ativos.qtd > 0
--   AND v.quantidade_posicoes IS NULL;
