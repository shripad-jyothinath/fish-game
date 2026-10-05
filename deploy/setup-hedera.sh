#!/usr/bin/env bash
# Install Hedera testnet credentials on the VPS and provision the on-chain
# pieces (HCS topic, $GOLD token, NFT collection) via `hedera:setup --write-env`.
#
# Usage (on the VPS, as root):
#   bash deploy/setup-hedera.sh
# or non-interactively:
#   HEDERA_OPERATOR_ID=0.0.x HEDERA_OPERATOR_KEY=302e... bash deploy/setup-hedera.sh
#
# Safe: backs up apps/api/.env first, only rewrites HEDERA_* lines and appends a
# fresh WALLET_ENCRYPTION_KEY if one is missing. Never touches other settings.
set -euo pipefail

APP_DIR="${FISHIO_APP_DIR:-/opt/fishio/app}"
ENV_FILE="$APP_DIR/apps/api/.env"

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found (is Fish.IO installed?)" >&2
  exit 1
fi

OPERATOR_ID="${HEDERA_OPERATOR_ID:-}"
OPERATOR_KEY="${HEDERA_OPERATOR_KEY:-}"

if [ -z "$OPERATOR_ID" ]; then
  read -rp "Hedera operator account ID (e.g. 0.0.123456): " OPERATOR_ID
fi
if [ -z "$OPERATOR_KEY" ]; then
  read -rsp "Hedera operator DER private key (input hidden): " OPERATOR_KEY
  echo
fi
OPERATOR_ID="$(printf '%s' "$OPERATOR_ID" | tr -d '[:space:]')"
OPERATOR_KEY="$(printf '%s' "$OPERATOR_KEY" | tr -d '[:space:]')"

if [ -z "$OPERATOR_ID" ] || [ -z "$OPERATOR_KEY" ]; then
  echo "error: both the account ID and the private key are required" >&2
  exit 1
fi
if ! printf '%s' "$OPERATOR_ID" | grep -qE '^0\.0\.[0-9]+$'; then
  echo "error: '$OPERATOR_ID' does not look like a Hedera account ID (0.0.x)" >&2
  exit 1
fi
if [ "${#OPERATOR_KEY}" -lt 64 ]; then
  echo "error: the private key looks too short — paste the full DER key" >&2
  exit 1
fi

BACKUP="$ENV_FILE.bak.$(date +%s)"
cp -a "$ENV_FILE" "$BACKUP"
echo "[fishio] env backup: $BACKUP"

sed -i '/^HEDERA_NETWORK=/d;/^HEDERA_OPERATOR_ID=/d;/^HEDERA_OPERATOR_KEY=/d' "$ENV_FILE"
{
  echo 'HEDERA_NETWORK=testnet'
  echo "HEDERA_OPERATOR_ID=$OPERATOR_ID"
  echo "HEDERA_OPERATOR_KEY=$OPERATOR_KEY"
} >> "$ENV_FILE"

if ! grep -q '^WALLET_ENCRYPTION_KEY=' "$ENV_FILE"; then
  if command -v openssl >/dev/null 2>&1; then
    echo "WALLET_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> "$ENV_FILE"
  else
    echo "WALLET_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$ENV_FILE"
  fi
  echo "[fishio] generated WALLET_ENCRYPTION_KEY"
fi

chmod 600 "$ENV_FILE"
chown fishio:fishio "$ENV_FILE" 2>/dev/null || true

# Provision topic / $GOLD / NFT collection and write their IDs back into .env.
cd "$APP_DIR"
echo "[fishio] provisioning HCS topic, \$GOLD token and NFT collection..."
npm --workspace @fishio/api run hedera:setup -- --write-env

systemctl restart fishio-api
sleep 2
echo "[fishio] API status:"
curl -fsS http://127.0.0.1:18080/api/v1/status || true
echo
echo "[fishio] done. Verify externally: curl -s https://api.<domain>/api/v1/status"
