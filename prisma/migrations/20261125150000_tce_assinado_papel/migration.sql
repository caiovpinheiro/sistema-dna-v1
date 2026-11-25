-- TCE assinado em papel (a caneta): o arquivo escaneado ou fotografado anexado na ficha do termo.
-- arquivo = nome do arquivo na pasta dos PDFs do TCE (PDF_STORAGE_DIR); tipo = application/pdf, image/jpeg ou image/png.
ALTER TABLE dna_work.termo_estagio
  ADD COLUMN IF NOT EXISTS assinado_papel_arquivo character varying(200),
  ADD COLUMN IF NOT EXISTS assinado_papel_tipo character varying(60),
  ADD COLUMN IF NOT EXISTS assinado_papel_em timestamp without time zone,
  ADD COLUMN IF NOT EXISTS assinado_papel_por character varying(180);
