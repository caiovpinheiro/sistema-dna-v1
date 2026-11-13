-- Página nova nas Configurações: "Disparador Infojobs" (link externo do menu).
-- Até aqui o item aparecia para todos; libera para quem já tem login, para ninguém perder o acesso.
-- Depois disso, o administrador marca ou desmarca por usuário em Configurações.
INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina)
SELECT u.id, 'disparador'
FROM dna_work.app_usuario u
ON CONFLICT DO NOTHING;
