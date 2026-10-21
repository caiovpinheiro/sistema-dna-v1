-- Consultas somente leitura usadas na auditoria de 2026-10-21.
-- Não retornam CPF, nome, e-mail ou endereço. Não alterar dados.

BEGIN READ ONLY;

SELECT id, descricao FROM dna_work.modalidade_vaga ORDER BY id;

SELECT status, count(*) FROM dna_work.conratacaovaga GROUP BY status ORDER BY 1;
SELECT status, count(*) FROM dna_work.vaga GROUP BY status ORDER BY 1;
SELECT status, count(*) FROM dna_work.empresa GROUP BY status ORDER BY 1;

SELECT column_default
FROM information_schema.columns
WHERE table_schema = 'dna_work'
  AND table_name = 'conratacaovaga'
  AND column_name = 'id_contratacao';

SELECT pg_get_serial_sequence('dna_work.conratacaovaga', 'id_contratacao');

SELECT count(*) AS foreign_keys
FROM pg_constraint
WHERE connamespace = 'dna_work'::regnamespace AND contype = 'f';

ROLLBACK;
