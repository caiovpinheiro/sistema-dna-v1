# MCP DNA Work — Fase 2A (núcleo no monólito)

> Última revisão: 2026-11-26. Estado: **Fase 2B** (núcleo no monólito + gateway `mcp-server/` + mTLS + workflows). A aba "Integrações MCP" e a tela de consentimento (Fase 4) ainda não existem. Veja também [mtls.md](mtls.md) e [implantacao.md](implantacao.md).

O MCP roda em dois serviços do mesmo repositório. O monólito continua sendo o único dono de usuários, OAuth, permissões, ferramentas e auditoria. O `mcp-server` (2B) só fala o protocolo MCP e repassa as chamadas, sem banco e sem cache de autorização.

```
ChatGPT ─HTTPS─► mcp.dnawork.ai (gateway, 2B)
                      │  rede privada · HMAC dedicado (+ TLS/mTLS opcional) · token do usuário
                      ▼
                 monólito: listener INTERNO (MCP_INTERNAL_PORT) /internal/mcp/:slug/*
ChatGPT/navegador ─► monólito: listener PÚBLICO /oauth/*, /.well-known/*, /api/v1/mcp/interacao/*
```

## Feature flag

`MCP_ENABLED` (padrão desligado). Desligado, nada é registrado: nenhuma rota OAuth, nenhuma rota interna, nenhum listener. Ligado com configuração incompleta ou insegura (URL sem https, segredo curto, sem segredos), o boot falha.

## Variáveis de ambiente (monólito)

| Variável | Para que serve |
|---|---|
| `MCP_ENABLED` | `1`/`true` liga. Padrão: desligado. |
| `MCP_PUBLIC_URL` | Origem do gateway (ex.: `https://mcp.dnawork.ai`). O `resource` OAuth é `<MCP_PUBLIC_URL>/mcp/<slug>`. |
| `APP_PUBLIC_URL` | Origem do painel = emissor OAuth (`issuer`). Definir antes da implantação. |
| `MCP_INTERNAL_PORT` / `MCP_INTERNAL_HOST` | Listener interno (padrão 3334 / 0.0.0.0). Nunca publicar no domínio. |
| `MCP_GATEWAY_SECRETS` | `id:segredo,id2:segredo2` (32+ caracteres cada). O gateway assina com um deles; vários permitem rotação sem queda. |
| `MCP_HMAC_JANELA_S` | Tolerância de relógio da assinatura (padrão 60). |
| `MCP_INTERNAL_TLS_CERT` / `_KEY` / `_CA` | **mTLS obrigatório** no listener interno (validado no boot; falha fechada). |
| `MCP_INTERNAL_INSECURE` | Só dev/teste, nunca em produção: listener interno em texto puro. |
| `MCP_INTERNAL_CLIENTES` | CNs/SANs de cliente aceitos (ex.: `gateway-mcp`). |
| `MCP_CONTRATOS` | Versões do contrato interno aceitas (`1`, `1,2` durante uma troca). |
| `MCP_OAUTH_REDIRECT_URIS` | Redirect URIs **exatas** (precedência sobre hosts). Ex.: `https://chatgpt.com/connector_platform_oauth_redirect`. |
| `MCP_OAUTH_CIMD_URLS` | `client_id` (URL do CIMD) **exatos** aceitos. Ex.: `https://chatgpt.com/oauth/client.json`. |
| `MCP_OAUTH_DCR` | `1` liga o registro dinâmico (DCR). Padrão: desligado. |
| `MCP_OAUTH_CLIENTS` | JSON de clientes pré-cadastrados (`client_id`, `client_secret` opcional, `redirect_uris`). Segredos só no ambiente. |
| `MCP_OAUTH_REDIRECT_HOSTS` | Lista de hosts permitidos nos redirects (opcional, restringe todos os tipos de cliente). |
| `MCP_OAUTH_COOKIE_SECRET` | Chave dos cookies do OAuth (padrão: derivada do `JWT_SECRET`). |
| `MCP_ACCESS_TTL_S` / `MCP_REFRESH_TTL_S` | Validade do access token (3600) e do refresh/grant (30 dias). |
| `MCP_RATE_USUARIO_POR_MIN` | Chamadas por minuto por usuário e integração (120). |
| `MCP_OAUTH_RATE_POR_MIN` | Limite por IP em `/oauth/token`, `/oauth/revoke` e `/oauth/register` (30). |

Segredos gerados com `openssl rand -base64 48`; ficam só nas variáveis do EasyPanel dos dois serviços.

## OAuth (biblioteca `oidc-provider`, certificada)

- Authorization Code com **PKCE S256 obrigatório** (plain recusado). Escopo `mcp:read`.
- **Client ID Metadata Document (CIMD)**, DCR (opcional) e clientes pré-cadastrados. Redirect URI sempre exata e `https` (ou `http` em loopback).
- `resource` (RFC 8707) obrigatório e exatamente `<MCP_PUBLIC_URL>/mcp/<slug>` de uma integração **ativa**; vira o `aud` do token (opaco).
- Resposta de autorização com `iss` (RFC 9207). Metadados em `/.well-known/oauth-authorization-server`.
- Códigos e refresh tokens de uso único, com consumo atômico no banco; reuso revoga o grant inteiro. Refresh com rotação. Revogação em `/oauth/revoke` (RFC 7009).
- Segredos (códigos, tokens, sessões) ficam só como SHA-256 em `dna_work.mcp_oauth_registro`.
- Consentimento no painel: `GET /api/v1/mcp/interacao/:uid` e `POST .../decisao` (sessão do painel + `Origin`). Só usuário real, ativo e vinculado; o `bootstrap-admin` nunca autoriza.

## Contrato interno v1 (gateway → monólito)

Todas as rotas são `POST` JSON em `/internal/mcp/:slug/<operacao>`: `integracao`, `autenticar`, `ferramentas`, `executar`.

Cabeçalhos obrigatórios: `X-MCP-Contract: 1`, `X-MCP-Key-Id`, `X-MCP-Timestamp` (segundos), `X-MCP-Nonce` (16–80 caracteres, uso único), `X-MCP-Request-Id`, `X-MCP-Signature` e, nas rotas com usuário, `Authorization: Bearer <access token do usuário>`.

Assinatura (`base64url(HMAC-SHA256(segredo, texto))`), texto com linhas separadas por `\n`:

```
DNAWORK-MCP-HMAC-V1
<MÉTODO>
<caminho com query>
<contrato>
<key id>
<timestamp>
<nonce>
<request id>
<sha256 hex do corpo>
<sha256 hex do token do usuário, ou "-">
```

O monólito confere assinatura e janela de tempo, **depois** consome o nonce de forma atômica (chave primária no Postgres, vale entre réplicas), **depois** valida o token do usuário (audience = esta integração, grant vivo) e recalcula a política. A identidade do usuário vem só do token; cabeçalhos de identidade são ignorados. O token do MCP não vale em nenhuma rota `/api/*` do painel e nenhum token é repassado a terceiros.

Respostas: `{ success, data | error }` com `X-MCP-Contract-Version`. `401` token inválido/ausente (o gateway responde 401 + `WWW-Authenticate` ao cliente), `403` usuário inativo/não autorizado/integração desativada, `404` integração ou ferramenta indisponível (mesma resposta para "não existe" e "sem permissão"), `422` corpo inválido, `429` limite excedido, `500` auditoria indisponível (falha fechada). Erros de ferramenta voltam como `data.isError = true`.

Compatibilidade: gateway e monólito ignoram campos desconhecidos; contratos novos só entram depois de o monólito suportar `N` e `N-1`.

## Permissões (a cada chamada, nada em cache)

integração ativa ∧ usuário real e ativo ∧ vínculo usuário↔integração ∧ ferramenta ligada na integração ∧ ferramenta liberada ao usuário ∧ escopo do token ∧ (ferramenta `adminOnly` → admin efetivo) ∧ página do módulo liberada (admin = todas). Admin vem do `AcessoService`, nunca do `role` do JWT. Integração nova nasce desativada e sem ferramentas.

## Dados

Migration aditiva `prisma/migrations/20261126120000_mcp_base` (só `CREATE TABLE IF NOT EXISTS`): `mcp_integracao`, `mcp_integracao_ferramenta`, `mcp_integracao_usuario`, `mcp_oauth_registro`, `mcp_nonce`, `mcp_limite`, `mcp_auditoria`. O gateway nunca a executa. Rollback: desligar `MCP_ENABLED`; as tabelas podem ficar.

## Ferramenta da Fase 2A

`consultar_filtros_vagas` (só leitura, projeção `id`/`nome`, página `vagas`). Serve para validar a arquitetura; as demais entram na Fase 3.

## Testes

```bash
MCP_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npx tsx --test backend/test/mcp-*.test.ts
```

Cada arquivo cria e apaga seu próprio banco em um PostgreSQL local (nunca produção). Sem `MCP_TEST_DATABASE_URL`, usa `embedded-postgres`, que não roda como root.

## Fase 2B — o que mudou

- **Gateway `mcp-server/`**: serviço independente (Node/TypeScript, SDK oficial, Streamable HTTP sem sessão, catálogo dinâmico, sem banco). `/health` (liveness) e `/ready` (certificados, monólito, contrato, issuer e URL pública). Erros 401 (`WWW-Authenticate` com `resource_metadata` do caminho exato `/.well-known/oauth-protected-resource/mcp/:slug`), 403, 429 e 503 controlados.
- **Canal interno**: mTLS obrigatório + HMAC + token do usuário (`docs/mcp/mtls.md`). Rota interna `POST /internal/mcp/saude` informa contratos, issuer e URL pública.
- **OAuth/ChatGPT**: `resource` obrigatório; escopo ausente ou desconhecido (`offline_access`) vira `mcp:read`; refresh token emitido sem `offline_access` quando o cliente declara `refresh_token`; CIMD e redirect por **lista exata**; JWKS persistido no banco (todas as réplicas servem o mesmo).
- **Workflows** de CI e deploy independente (`docs/mcp/implantacao.md`).

### Comportamento do `oidc-provider` com o CIMD (validado em teste)

- `token_endpoint_auth_method: "none"` funciona.
- Se o documento lista `private_key_jwt` em `token_endpoint_auth_methods_supported`, a biblioteca **exige `jwks` ou `jwks_uri`** e passa a **exigir a assertion** `private_key_jwt` no `/oauth/token` (sem ela, 401).
- Documento sem `refresh_token` em `grant_types` → sem refresh token.
- Conferir com o documento real do ChatGPT (`https://chatgpt.com/oauth/client.json`) antes do go-live.

## Fase 3 — o que mudou

- **28 ferramentas** somente leitura ([ferramentas.md](ferramentas.md)); saída validada de forma estrita; limites por hora para as que usam serviço externo; links internos; `ausentes`; `_meta.securitySchemes`.
- **OAuth/ChatGPT**: documento real do ChatGPT (`private_key_jwt`, RS256, `jwks_uri`) coberto por teste com chaves descartáveis; o grant `jwt-bearer` do documento **não** é habilitado (o provider só aceita `authorization_code` e `refresh_token`); assertion validada (assinatura, alg, iss, sub, aud, exp, jti, replay entre réplicas); `jwks_uri` em cache curto (`MCP_JWKS_CACHE_S`, padrão 60 s) invalidado por falha de autenticação (rotação); escopo padrão só quando o cliente **omite** `scope` (`MCP_ESCOPO_PADRAO`, vazio = exigir) e mostrado no consentimento; escopos desconhecidos são ignorados e nunca viram `mcp:read` (só desconhecidos = recusa).
- **Descoberta sem login** (`MCP_DESCOBERTA_PUBLICA`, gateway) — ver [ferramentas.md](ferramentas.md).
- **Manutenção** (`MCP_AUDITORIA_RETENCAO_DIAS` 180, mínimo 30, 0 = não apagar; `MCP_OAUTH_RETENCAO_DIAS` 7; `MCP_MANUTENCAO_INTERVALO_MIN` 60, 0 = desligada; `MCP_NONCE_TTL_S`, nunca abaixo de 2x a janela do HMAC): limpa nonces, contadores, registros OAuth vencidos e auditoria antiga; uma réplica por vez (trava no banco).
- `MCP_FERRAMENTA_TIMEOUT_MS` (20 s): tempo máximo de uma ferramenta.


## Fase 4 — gestão administrativa

- Aba **Integrações MCP** em Configurações (`/configuracoes?aba=mcp`, só administrador): integrações, ferramentas por módulo, colaboradores, abrangência, auditoria e status da infraestrutura. Detalhes em `docs/agentes/configuracoes/agente.md`.
- **Abrangência dos registros** (nenhuma, autorizados, todos; "próprios" e "equipe" indisponíveis por falta de vínculo no banco): `docs/mcp/abrangencia.md`.
- **Tela de autorização OAuth** (`/mcp/autorizar/:uid`): `docs/agentes/mcp-autorizar/agente.md`.
- Migration aditiva `20261127120000_mcp_gestao`. Nada de segredo na interface: chaves e segredos HMAC continuam só no EasyPanel.
- Total de ferramentas: 29 (a nova é `listar_registros_autorizados`). Indicadores gerenciais agora exigem `gestao:indicadores` (ou administrador) e abrangência `todos`.


## Fase 5 — base de conhecimento

- Aba **Base de conhecimento** em Configurações; ferramentas `buscar_conhecimento`, `consultar_documento` e `listar_categorias_conhecimento` (total: 32 ferramentas). Detalhes, modelo, pesquisa, segurança e importação em `docs/mcp/conhecimento.md`.
- Migration aditiva `20261128120000_conhecimento` (cria também as 16 categorias iniciais, sem artigos).
- Abrangência futura por responsável do lead no Bwipo: só documentada (`abrangencia.md`).
