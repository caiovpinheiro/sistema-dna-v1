# Regras do projeto

## Documentação das páginas (agente.md)

Cada seção do menu tem um `docs/agentes/<secao>/agente.md`. O índice e o mapa "arquivo da página → agente" ficam em `docs/agentes/README.md`.

- **Antes de mexer numa página**, leia o `agente.md` dela.
- **Ao alterar uma página** (qualquer arquivo em `frontend/src/pages`, ou a rota, service, repository ou componente que só ela usa), atualize o `agente.md` da seção no mesmo commit: o que mudou nas rotas, abas, API, dados, regras ou cuidados, e a linha `> Última revisão: AAAA-MM-DD (commit …)`.
- **Ao criar uma página nova**, crie `docs/agentes/<secao>/agente.md` seguindo o formato dos outros (Para que serve, Rotas e abas, Arquivos, API usada, Dados, Regras e comportamentos importantes, Cuidados ao mudar, Como testar) e acrescente o arquivo na tabela de `docs/agentes/README.md`. Uma aba nova dentro de uma seção que já existe entra no `agente.md` dessa seção, sem criar outro.
- **Ao apagar ou renomear uma página**, ajuste a tabela e o `agente.md`.
- Antes de commitar, rode `npm run agentes:conferir`. Ele falha se alguma página de `frontend/src/pages` não tiver agente.
- Nada de dados pessoais, senhas, tokens ou valores do `.env` nos `agente.md`; só nomes de variáveis.
