# DNAWORK V1

Sistema administrativo de recrutamento e seleção. O frontend React conversa com a API Fastify, e a API conversa com o schema `dna_work`. Esta versão cobre candidato, empresa, vaga e contratação CLT/estágio.

Os comandos locais não alteram a base atual. Testes sobem um PostgreSQL local, vazio. No deploy, o container executa `prisma migrate deploy` antes de iniciar a API.

## Requisitos

- Node.js 22 ou superior
- npm 11
- Para o dia a dia: Docker **ou** o PostgreSQL embutido do script local

Não é necessário instalar o PostgreSQL do sistema para desenvolver nesta máquina Windows.

## Configuração

```bash
cp .env.example .env
```

No Windows, se `cp` não existir:

```powershell
Copy-Item .env.example .env
```

Gere o hash da senha administrativa e coloque em `ADMIN_PASSWORD_HASH`:

```bash
npm run hash-password -- "uma-senha-forte"
```

Em desenvolvimento, `ADMIN_PASSWORD` também funciona. A senha é convertida para Argon2id só na memória do processo. Não coloque senha, token ou URL da base atual no `.env` que for versionado. O arquivo `.env` está no `.gitignore`.

## Banco local

### Windows e Linux, sem Docker

```bash
npm install
npm run db:local
```

O comando sobe um PostgreSQL somente em `127.0.0.1:54330`, cria o banco `dnawork` e aplica `database/schema/local-dev.sql`. Deixe esse terminal aberto. O `.env.example` já aponta para essa URL.

### Docker

```bash
docker compose up -d
```

O compose publica a mesma porta `54330` e inicializa o schema local. Ele não conhece a base atual.

### Linux com PostgreSQL próprio

Crie um banco vazio chamado `dnawork` e aplique o schema:

```bash
psql "postgres://postgres:postgres@127.0.0.1:5432/dnawork" -f database/schema/local-dev.sql
```

Ajuste `DATABASE_URL` no `.env`.

## Executar

```bash
npm install
npm run dev
```

- Interface: http://localhost:5173
- API: http://127.0.0.1:3333
- OpenAPI: http://127.0.0.1:3333/docs
- Saúde: http://127.0.0.1:3333/health

O Vite encaminha `/api` para a API, então o cookie de sessão fica no mesmo site.

## Testes, build e verificação de tipos

```bash
npm test
npm run lint
npm run build
```

`npm test` recusa conexão que não seja `localhost` e recusa o nome de banco da base atual. O PostgreSQL de teste é criado num diretório temporário e removido ao final.

## Antes de apontar para a base existente

1. Revogar o token e trocar a senha que foram expostos fora do repositório.
2. Ler `docs/database-audit.md` e `docs/pending-decisions.md`.
3. O deploy aplica sozinho a migration `20261021183000_v1_foundation`, equivalente aos arquivos `001` a `004`.
4. Decidir o backfill da `005`. Sem `quantidade_posicoes`, vaga antiga não aceita contratação.
5. Confirmar `VAGA_STATUS_BLOQUEADAS` e `ALLOW_MULTIPLE_ACTIVE_LINKS`.

O GitHub Actions publica a imagem e chama o webhook do EasyPanel. O container aplica as migrations pendentes e só então sobe a API.
