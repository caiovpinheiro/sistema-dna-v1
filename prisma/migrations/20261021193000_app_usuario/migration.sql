CREATE TABLE IF NOT EXISTS dna_work.app_usuario (
  id uuid PRIMARY KEY,
  nome character varying(160) NOT NULL,
  email character varying(160) NOT NULL UNIQUE,
  senha_hash character varying(255) NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

INSERT INTO dna_work.app_usuario (id, nome, email, senha_hash)
VALUES
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c11', 'Ketolyn Cristina de Paulo Gonçalves', 'ketolyn@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$jJ6sZuLv4bT8MhevDPHikw$HXI3/x/wZbiUoylbYWzRLV3/uwkpw0jd5ix76nbFxxw'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c12', 'Emanuel dos Santos Chaves', 'emanuel@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$d3u0NBr8GFBuVdSW+iNhsg$T7HPP8ngcqEnWdQxbA78STRo069Z0BGga0sGFHmqQ+4'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c13', 'Isabeli Elias Ferreira Campos', 'isabeli@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$DyVijQc5qo4KDIrGbED0gA$wthmm9bcZg/SR7QOp6Bpz177rRufwdw2+oxcBVdyw/g'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c14', 'Ketly Carvalho da Silva', 'ketly@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$HN4/S64iyoVdnNBbWS07JQ$LmeFgd4ybHYRDW8kMYofD3oI3C6mObFIOhviaz+SFvg'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c15', 'Eduardha Mendes', 'eduardha@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$QfXT8N0gxZzT8LCTWEvlYQ$2naMgvrnRNL6xdt0ebIdIKu+uWmoVfD+kwONwQJEOA4'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c16', 'Eduardo Maia', 'eduardo.maia@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$rYTb0q3qCeA09lq8BFa5Og$01wknfqp9ziFDT7+9+ufmddpiSuPuq+IAt5MvY7FuTo'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c17', 'Ana Flavia Pereira de Carvalho', 'ana.flavia@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$oMFH5N+NfPwbN78hD0SGYg$tSq1aVhCT77I4BnWpvUJdYsa1NmabITGDzDQ9c2O/vg'),
  ('8d2a1c10-6b4e-4a1d-9c3f-1a0e5b7d2c18', 'Diogo Alves', 'diogoalves@dnawork.ai', '$argon2id$v=19$m=19456,t=2,p=1$UulAGMC6EHtenb9KDJUy6A$0S9NIk0sla0qzsADRYBdo77OQl+3DIMKeXGH1s8pWrg')
ON CONFLICT (email) DO NOTHING;
