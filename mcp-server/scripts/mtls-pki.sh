#!/usr/bin/env bash
# PKI privada do canal interno gateway MCP <-> monólito (mTLS).
#
#   mtls-pki.sh ca        <dir> [--nome "DNA Work MCP CA"] [--dias 3650]
#   mtls-pki.sh servidor  <dir> --nome monolito --san DNS:monolito,DNS:projeto_monolito[,IP:10.0.0.5] [--dias 90]
#   mtls-pki.sh cliente   <dir> --nome gateway-mcp [--dias 90]
#   mtls-pki.sh verificar <dir>
#
# REGRAS: o diretório de saída NUNCA pode ficar dentro de um repositório Git (o script recusa).
# Chaves privadas ficam com permissão 0600. A chave da CA deve ficar OFFLINE (cofre), fora dos servidores.
set -euo pipefail
umask 077

uso() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }
[ $# -ge 2 ] || uso
cmd="$1"; dir="$2"; shift 2

nome=""; san=""; dias=""; cn_ca="DNA Work MCP CA interna"
while [ $# -gt 0 ]; do
  case "$1" in
    --nome) nome="$2"; shift 2;;
    --san) san="$2"; shift 2;;
    --dias) dias="$2"; shift 2;;
    *) echo "argumento desconhecido: $1" >&2; uso;;
  esac
done
[ "$cmd" = ca ] && [ -n "$nome" ] && cn_ca="$nome"

mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "RECUSADO: $dir está dentro de um repositório Git. Certificados e chaves nunca vão para o GitHub." >&2
  exit 2
fi

gerar_chave() { openssl ecparam -genkey -name prime256v1 -noout -out "$1"; chmod 600 "$1"; }

case "$cmd" in
  ca)
    d="${dias:-3650}"
    [ ! -e "$dir/ca.key.pem" ] || { echo "já existe uma CA em $dir (não sobrescrevo)." >&2; exit 3; }
    gerar_chave "$dir/ca.key.pem"
    openssl req -x509 -new -key "$dir/ca.key.pem" -sha256 -days "$d" -subj "/CN=$cn_ca" \
      -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -out "$dir/ca.cert.pem"
    cp "$dir/ca.cert.pem" "$dir/ca-bundle.pem"
    echo "CA criada: $dir/ca.cert.pem (publicar o bundle; guardar ca.key.pem OFFLINE)";;
  servidor|cliente)
    [ -n "$nome" ] || { echo "informe --nome" >&2; exit 1; }
    [ -f "$dir/ca.key.pem" ] || { echo "CA não encontrada em $dir (rode 'ca' antes)" >&2; exit 1; }
    d="${dias:-90}"
    base="$dir/$nome"
    gerar_chave "$base.key.pem"
    openssl req -new -key "$base.key.pem" -subj "/CN=$nome" -out "$base.csr"
    ext="$(mktemp)"; trap 'rm -f "$ext"' EXIT
    if [ "$cmd" = servidor ]; then
      [ -n "$san" ] || { echo "informe --san (ex.: DNS:monolito,DNS:projeto_monolito)" >&2; exit 1; }
      printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san" > "$ext"
    else
      printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n' > "$ext"
    fi
    openssl x509 -req -in "$base.csr" -CA "$dir/ca.cert.pem" -CAkey "$dir/ca.key.pem" -CAcreateserial -sha256 -days "$d" -extfile "$ext" -out "$base.cert.pem" >/dev/null 2>&1
    rm -f "$base.csr"
    echo "emitido: $base.cert.pem (válido por $d dias) e $base.key.pem (0600)";;
  verificar)
    [ -f "$dir/ca.cert.pem" ] || { echo "sem CA em $dir" >&2; exit 1; }
    status=0
    for cert in "$dir"/*.cert.pem; do
      [ "$cert" = "$dir/ca.cert.pem" ] && continue
      fim="$(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)"
      if openssl verify -CAfile "$dir/ca-bundle.pem" "$cert" >/dev/null 2>&1; then r=ok; else r=FALHA; status=1; fi
      if openssl x509 -in "$cert" -noout -checkend $((14*86400)) >/dev/null 2>&1; then v="válido por mais de 14 dias"; else v="VENCE EM MENOS DE 14 DIAS"; status=1; fi
      echo "$(basename "$cert"): cadeia=$r; expira=$fim; $v"
      openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | sed 's/^ */  SAN: /' || true
    done
    exit $status;;
  *) uso;;
esac
