ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS beneficios_texto text;

UPDATE dna_work.vaga AS vaga
SET beneficios_texto = publicada.beneficios
FROM public.vaga AS publicada
WHERE publicada.id::text = vaga.id_vaga
  AND publicada.beneficios IS NOT NULL
  AND btrim(publicada.beneficios) <> ''
  AND (vaga.beneficios_texto IS NULL OR btrim(vaga.beneficios_texto) = '');
