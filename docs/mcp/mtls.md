# mTLS entre o gateway MCP e o monólito

> Última revisão: 2026-11-26 (Fase 2B). Certificados **descartáveis** nos testes; os definitivos são emitidos na implantação. **Nada disso vai para o GitHub.**

O canal interno usa **três camadas independentes**: mTLS (confidencialidade e identidade do par), assinatura HMAC (autenticidade, integridade e anti-replay de cada requisição) e o token OAuth do usuário (validado pelo monólito a cada chamada). A porta `3334` do monólito continua **só na rede privada**; mTLS não a torna pública.

## Quem confia em quem

| Peça | Material | Onde fica |
|---|---|---|
| CA privada | `ca.key.pem` (**offline**, cofre) e `ca.cert.pem` | Só o certificado vai para os serviços (`ca-bundle.pem`). A chave da CA nunca sai do cofre. |
| Monólito (servidor interno) | `monolito.cert.pem` + `monolito.key.pem`, com SAN = nomes pelos quais o gateway o acessa | Arquivos montados no serviço do monólito |
| Gateway (cliente) | `gateway-mcp.cert.pem` + `gateway-mcp.key.pem` (`extendedKeyUsage = clientAuth`) | Arquivos montados no serviço do gateway |

O monólito exige certificado de cliente (`requestCert`+`rejectUnauthorized`) e, com `MCP_INTERNAL_CLIENTES=gateway-mcp`, aceita só quem tem esse CN/SAN. O gateway valida a cadeia **e o hostname/SAN** do servidor (`MONOLITO_INTERNAL_URL` / `MONOLITO_TLS_SERVERNAME`).

## Falha fechada

| Situação | Monólito | Gateway |
|---|---|---|
| Certificado/chave/CA ausente, ilegível ou vazio | **não sobe** (boot falha) | sobe, `/health` 200, `/ready` 503, chamadas 503 `CERTIFICADO_INVALIDO` |
| Expirado ou ainda não válido | não sobe | idem (conferido a cada chamada, com o relógio atual) |
| Chave não casa com o certificado; servidor sem SAN; não emitido pela CA | não sobe | idem |
| Cliente sem certificado ou de outra CA | handshake recusado | — |
| Cliente com CN fora da lista | 403 `CERTIFICADO_CLIENTE_NAO_PERMITIDO` | 503 `CONFIGURACAO_INVALIDA` |
| Servidor com SAN diferente / CA diferente | — | handshake recusado → 503 |
| Texto puro (sem mTLS) | permitido só com `MCP_INTERNAL_INSECURE=1` (inclusive em produção); autenticação só por HMAC, rede privada | idem com `MCP_GATEWAY_INSEGURO=1` e `MONOLITO_INTERNAL_URL` em `http://` |

## Emissão (na implantação)

Use uma máquina confiável, **fora de qualquer repositório** (o script recusa gravar dentro de um repo Git).

```bash
mcp-server/scripts/mtls-pki.sh ca        ~/pki-dna-mcp                       # uma vez; guardar ca.key.pem OFFLINE
mcp-server/scripts/mtls-pki.sh servidor  ~/pki-dna-mcp --nome monolito --san DNS:<nome-interno-do-monolito>,DNS:localhost --dias 90
mcp-server/scripts/mtls-pki.sh cliente   ~/pki-dna-mcp --nome gateway-mcp --dias 90
mcp-server/scripts/mtls-pki.sh verificar ~/pki-dna-mcp                       # cadeia, validade e SAN
```

O `<nome-interno-do-monólito>` é o host que o gateway usa em `MONOLITO_INTERNAL_URL` (no EasyPanel, algo como `projeto_servico`; confirmar no painel). Se o nome mudar, reemita o certificado do servidor.

## Entrega aos serviços (sem GitHub)

No EasyPanel, em cada serviço, use **Mounts → File** (somente leitura) ou **Secrets** montados como arquivo:

| Serviço | Arquivos (caminho no container) | Variáveis |
|---|---|---|
| Monólito | `/run/mcp-tls/ca-bundle.pem`, `monolito.cert.pem`, `monolito.key.pem` | `MCP_INTERNAL_TLS_CA`, `MCP_INTERNAL_TLS_CERT`, `MCP_INTERNAL_TLS_KEY`, `MCP_INTERNAL_CLIENTES=gateway-mcp` |
| Gateway | `/run/mcp-tls/ca-bundle.pem`, `gateway-mcp.cert.pem`, `gateway-mcp.key.pem` | `MCP_TLS_CA`, `MCP_TLS_CERT`, `MCP_TLS_KEY` |

A chave de cada serviço fica só nesse serviço (0600). Cada serviço recebe apenas o seu par e o bundle da CA.

## Renovação (sem reiniciar)

1. Emita novos certificados (mesma CA) com o script e substitua os arquivos montados.
2. **Monólito**: confere os arquivos a cada 60 s; se o novo material for válido, troca o contexto TLS sem derrubar o listener; se for inválido, **mantém o anterior** e registra o erro.
3. **Gateway**: confere a cada `CERT_RECHECK_MS` (30 s) e a cada uso; certificado vencido derruba as chamadas na hora.
4. Acompanhe: `/ready` do gateway informa `diasCertificado`; o `verificar` alerta com menos de 14 dias. Ciclo recomendado: certificados de 90 dias, renovar com 30 dias de folga.

## Rotação de CA

1. Gere a **nova** CA; monte um `ca-bundle.pem` com **as duas** (antiga + nova) nos dois serviços (ambos aceitam bundles com várias CAs).
2. Reemita servidor e cliente com a nova CA e troque os arquivos (renovação sem reiniciar).
3. Quando nenhum certificado antigo estiver em uso, remova a CA antiga do bundle.

## Comprometimento

- Chave do gateway vazada: reemita `gateway-mcp`, troque `MCP_GATEWAY_SECRETS` (aceita dois segredos durante a troca) e revogue os tokens se houver suspeita de uso (botão no painel / `IntegracoesMcpService.revogar`). Sem a CA offline não há como emitir certificados válidos.
- Chave do monólito vazada: reemita `monolito`; rotacione a CA se a CA puder ter sido exposta.

## Prova de que a 3334 não está exposta (checklist da implantação)

1. No EasyPanel, o serviço do monólito **não** mapeia a porta 3334 no host e **nenhum domínio** aponta para ela.
2. De fora da rede privada: `curl -vk https://<ip-do-servidor>:3334/internal/mcp/saude` deve falhar (conexão recusada/timeout).
3. Pelo domínio público do painel: `curl -s -o /dev/null -w "%{http_code}" -X POST https://<painel>/internal/mcp/saude` deve responder **404** (o listener público não registra `/internal`; teste automatizado cobre isso).
4. Da rede privada sem certificado de cliente: `curl -vk https://<nome-interno>:3334/internal/mcp/saude` deve falhar no handshake.
5. Com certificado válido mas sem assinatura HMAC: 401.
Se o EasyPanel não permitir 1 e 2, **não implante**: avise antes (alternativas: rede Docker dedicada ou firewall do host).
