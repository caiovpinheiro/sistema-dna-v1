# Implantação do MCP (gateway `mcp-server` + monólito)

> Última revisão: 2026-11-26 (Fase 2B). **Nada foi criado no EasyPanel nem no DNS.** Itens marcados **[confirmar]** dependem do painel.

## Serviço novo no EasyPanel: `mcp-server`

- Projeto: o mesmo do monólito (rede privada compartilhada). Nome interno do monólito para o `MONOLITO_INTERNAL_URL` **[confirmar]**.
- Origem: **imagem Docker** `ghcr.io/<owner>/<repo>-mcp:latest` (construída por `deploy-independente.yml`), com o webhook de deploy do serviço guardado no secret `WEBHOOK_DEPLOY_MCP_SERVER`. Alternativa: GitHub + caminho de build `/mcp-server` + `Dockerfile` **[confirmar]**.
- Domínio: `mcp.dnawork.ai` → porta **3000**, HTTPS automático (DNS apontando para o servidor antes de emitir o certificado).
- Healthcheck: `GET /health` (liveness). Readiness/monitoramento: `GET /ready` (200 só com certificados válidos, monólito alcançável, contrato compatível, `issuer` e `MCP_PUBLIC_URL` idênticos aos do monólito).
- Recursos: ~256 MB, sem volume, sem banco. Usuário não root. Reinício automático ligado (o gateway **não** sai por causa do monólito fora do ar; só configuração inválida derruba o processo no boot).
- Mounts (somente leitura): certificados mTLS (ver `docs/mcp/mtls.md`).
- Proxy do EasyPanel: `TRUST_PROXY=1` para o limite por IP enxergar o cliente real.

## Variáveis de ambiente

### Gateway (`mcp-server`) — nomes apenas; valores nunca no GitHub

| Variável | Obrig. | Descrição |
|---|---|---|
| `MCP_PUBLIC_URL` | sim | `https://mcp.dnawork.ai` (origem; o `resource` OAuth é `<origem>/mcp/<slug>`) |
| `MONOLITO_ISSUER_URL` | sim | URL pública do painel = `issuer` OAuth (**idêntico** ao `APP_PUBLIC_URL` do monólito) |
| `MONOLITO_INTERNAL_URL` | sim | `https://<nome-interno>:3334` |
| `MONOLITO_TLS_SERVERNAME` | não | Nome esperado no SAN (padrão: host da URL acima) |
| `MCP_GATEWAY_KEY_ID`, `MCP_GATEWAY_SECRET` | sim | Id e segredo (32+ caracteres) da assinatura HMAC; o id precisa constar em `MCP_GATEWAY_SECRETS` do monólito |
| `MCP_TLS_CA`, `MCP_TLS_CERT`, `MCP_TLS_KEY` | sim | Caminhos dos arquivos montados (mTLS) |
| `MCP_CONTRATO` | não | Versão do contrato interno (padrão 1) |
| `MCP_ALLOWED_HOSTS` | não | Hosts aceitos (padrão: host de `MCP_PUBLIC_URL`; evita DNS rebinding) |
| `MCP_ALLOWED_ORIGINS` | não | Origens de navegador aceitas (padrão: nenhuma; o ChatGPT não envia `Origin`) |
| `TRUST_PROXY` | não | `1` atrás do proxy do EasyPanel |
| `PORT`, `HOST`, `LOG_LEVEL` | não | 3000, 0.0.0.0, info |
| `REQUEST_TIMEOUT_MS`, `CONNECT_TIMEOUT_MS`, `MAX_BODY_BYTES`, `RATE_LIMIT_POR_MIN`, `SHUTDOWN_TIMEOUT_MS`, `CERT_RECHECK_MS` | não | Limites e tempos (25000, 3000, 262144, 300, 10000, 30000) |

### Monólito (acréscimos; ver também `docs/mcp/README.md`)

`MCP_ENABLED=1`, `MCP_PUBLIC_URL`, `APP_PUBLIC_URL`, `MCP_INTERNAL_PORT=3334`, `MCP_GATEWAY_SECRETS=<id>:<segredo>[,<id2>:<segredo2>]`, `MCP_INTERNAL_TLS_CA/CERT/KEY`, `MCP_INTERNAL_CLIENTES=gateway-mcp`, `MCP_CONTRATOS=1`, e, para o ChatGPT:

```
MCP_OAUTH_CIMD_URLS=https://chatgpt.com/oauth/client.json
MCP_OAUTH_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect
```

(acrescente URIs de retorno específicas de cada conexão, se o ChatGPT fornecer; **não** libere o domínio inteiro). Alterar variáveis reinicia o monólito: faça isso uma vez, no go-live.

## Workflows

| Arquivo | Quando roda | O que faz |
|---|---|---|
| `mcp-ci.yml` | todo push/PR e manual | Detecta o que mudou; roda lint, build e testes do monólito e/ou do MCP (Postgres de serviço); build da imagem sem publicar. **Nunca implanta.** |
| `deploy-independente.yml` | push na `main` (só `mcp-server/**`, e só com a variável `MCP_DEPLOY_AUTOMATICO=true`) e manual | Plano → testes → imagem → deploy do monólito (aprovação) → deploy do MCP (aprovação). Fila única `deploy-producao`; `simular` só valida; `rollback_mcp_para_sha` restaura uma imagem anterior. |
| `deploy.yml` (existente, **inalterado**) | push na `main` | Continua construindo e implantando o monólito. |

Configuração necessária no GitHub (não feita): Environments `producao-monolito` e `producao-mcp` com **Required reviewers**; secrets `WEBHOOK_DEPLOY_MCP_SERVER` (e o existente `WEBHOOK_DEPLOY_SISTEMA_DNA`); variáveis `MONOLITO_URL_SAUDE`, `MCP_URL_PRONTO`, `MCP_DEPLOY_AUTOMATICO` (deixar fora ou `false`).

Ordem segura: **migrations e mudanças de contrato vão sempre no monólito primeiro** (ele aceita contratos N e N-1 via `MCP_CONTRATOS`); o gateway só sobe depois do monólito saudável. Gateway N+1 contra monólito N fica "não pronto" (503 controlado), sem quebrar nada.

## Um dono por componente (sem deploy duplicado)

| Componente | Quem implanta (padrão) | Como o outro se comporta |
|---|---|---|
| Monólito | `deploy.yml` (existente, inalterado) a cada push na `main` | `deploy-independente.yml` **não** dispara o webhook do monólito: o job `aguardar-monolito` espera o `deploy.yml` do mesmo commit e o monólito saudável, e só então implanta o MCP |
| Gateway MCP | `deploy-independente.yml` (manual com aprovação, ou push em `mcp-server/**` com `MCP_DEPLOY_AUTOMATICO=true`) | `deploy.yml` não o toca |

A titularidade do monólito só muda com **autorização expressa**: defina `MONOLITO_DEPLOY_DONO=deploy-independente` e, **no mesmo momento**, desative o gatilho do `deploy.yml`. Enquanto a variável não existir, o alvo manual `monolito` é recusado. O `deploy.yml` agora tem `paths-ignore` (`mcp-server/**`, `docs/mcp/**` e os workflows do MCP): um push na `main` que mexe só no gateway **não** redeploya o monólito; qualquer push que toque outro arquivo continua implantando como sempre. Cobertura por `scripts/workflows.test.mjs`. A mudança só vale depois do merge na `main` (que depende da sua decisão).

## Go-live (sequência)

1. Autorização expressa do merge; deploy do monólito com a migration `20261126120000_mcp_base` e `MCP_ENABLED` ainda **desligado**.
2. Emitir certificados (mTLS), montar nos dois serviços, definir variáveis, DNS de `mcp.dnawork.ai`, criar o serviço no EasyPanel.
3. Ligar `MCP_ENABLED=1` (reinício único do monólito). Conferir `/ready` do gateway.
4. Criar a integração e vincular usuários (service/Fase 4), conectar o ChatGPT e testar com um usuário.

## Rollback

| Situação | Ação |
|---|---|
| Qualquer problema no MCP | `MCP_ENABLED=` (vazio) no monólito: `/oauth`, `/internal` e consentimento passam a responder 404; o painel segue igual |
| Gateway com defeito | Workflow com `rollback_mcp_para_sha` (reaponta `:latest`), ou parar o serviço no EasyPanel; o monólito não é afetado |
| Monólito com defeito | Redeploy da imagem anterior (`ghcr.io/<repo>:<sha>`); as migrations são aditivas e o código antigo as ignora |
| Credencial exposta | Revogar tokens, rotacionar `MCP_GATEWAY_SECRETS` (dois segredos) e/ou reemitir certificados (`docs/mcp/mtls.md`) |

## Variáveis novas da Fase 3

Monólito: `MCP_ESCOPO_PADRAO` (mcp:read), `MCP_JWKS_CACHE_S` (60), `MCP_FERRAMENTA_TIMEOUT_MS` (20000), `MCP_AUDITORIA_RETENCAO_DIAS` (180), `MCP_OAUTH_RETENCAO_DIAS` (7), `MCP_MANUTENCAO_INTERVALO_MIN` (60), `MCP_NONCE_TTL_S`. Gateway: `MCP_DESCOBERTA_PUBLICA` (ligada). GitHub (variável): `MONOLITO_DEPLOY_DONO`.

Para o ChatGPT (CIMD com `private_key_jwt`, preferencial): `MCP_OAUTH_CIMD_URLS=https://chatgpt.com/oauth/client.json` e `MCP_OAUTH_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect` (mais URIs por conexão, se o ChatGPT fornecer). O servidor de autorização precisa de saída HTTPS para `chatgpt.com` (busca do documento e do `jwks_uri`).
