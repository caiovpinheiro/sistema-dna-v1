create table if not exists dna_work.portal_empresa_acesso (
  id_empresa varchar(40) primary key,
  id_usuario varchar(40),
  email varchar(255),
  primeiro_login timestamptz,
  ultimo_login timestamptz,
  ultimo_uso timestamptz,
  logins integer not null default 0
);
