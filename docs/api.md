# API DNAWORK V1

Base: `/api/v1`. Cookie httpOnly `dnawork_session`. Documentação interativa em `/docs` com a API no ar.

Envelope de sucesso:

```json
{ "success": true, "data": {}, "meta": {} }
```

Erro:

```json
{ "success": false, "error": { "code": "CPF_DUPLICADO", "message": "Já existe um candidato com este CPF." } }
```

`422` validação, `401` sem sessão, `403` sem permissão, `404` ausente, `409` conflito, `503` migration ainda não aplicada.

## Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "admin@dnawork.local", "password": "senha-do-ambiente" }
```

```json
{ "success": true, "data": { "email": "admin@dnawork.local", "role": "admin" }, "meta": {} }
```

`GET /api/v1/auth/me` devolve a sessão. `POST /api/v1/auth/logout` apaga o cookie.

## Exemplos

Criar candidato:

```http
POST /api/v1/candidatos
```

```json
{ "nome": "Ana Souza", "cpf": "12345678909", "email": "ana@example.com", "celular": "11987654321" }
```

Criar empresa:

```json
{ "razao_social": "Empresa ABC Ltda", "cnpj": "11222333000181", "email": "abc@example.com" }
```

Criar vaga:

```json
{ "id_empresa": "UUID", "cargo": "Auxiliar Administrativo", "tipo_vaga": 2, "salario": "1800,00", "quantidade_posicoes": 5 }
```

`tipo_vaga` é o `id` de `modalidade_vaga`. Na base atual, `1` é Estágio e `2` é CLT. A resposta inclui `ocupadas`, `disponiveis` e `situacao`.

Contratar:

```http
POST /api/v1/contratacoes
Idempotency-Key: 9f0c2d1a-7b3e-4c1a-9a11-6e5d0b2c4f80
```

```json
{ "id_candidato": "UUID_DO_CANDIDATO", "id_vaga": "UUID_DA_VAGA", "data_inicio": "2026-11-01" }
```

```json
{
  "success": true,
  "data": {
    "id_contratacao": 2501,
    "id_colaborador": "UUID",
    "id_candidato": "UUID_DO_CANDIDATO",
    "id_vaga": "UUID_DA_VAGA",
    "id_empresa": "UUID_DA_EMPRESA_DA_VAGA",
    "regime": "clt",
    "situacao": "ativa"
  },
  "meta": {}
}
```

A empresa não é escolhida pelo corpo. Se `id_empresa` vier e divergir da vaga, a resposta é `409`.

Encerrar:

```http
POST /api/v1/contratacoes/2501/encerrar
```

```json
{ "data_encerramento": "2026-12-15" }
```

O registro continua em `GET /api/v1/contratacoes/2501`.

## Pesquisa

Listas aceitam `page`, `pageSize` (máximo 100), `sort` e `order`. `sort` só aceita colunas da lista interna. `meta.total` traz a contagem.

Candidatos: `nome`, `cpf`, `email`, `telefone`, `cidade`, `uf`, `id_empresa`, `regime` (`clt` ou `estagio`), `situacao` (`ativo`, `encerrado`, `sem_vinculo`), `cadastro_de`, `cadastro_ate`.

Empresas: `q`, `razao_social`, `nome_fantasia`, `cnpj`, `cidade`, `uf`, `status`.

Vagas: `id_empresa`, `cargo`, `tipo_vaga`, `situacao`, `q`.

Contratações: `q`, `id_empresa`, `id_vaga`, `id_candidato`, `regime`, `status`.

`GET /api/v1/dashboard` e `GET /api/v1/modalidades` alimentam a interface. `GET /health` é público.
