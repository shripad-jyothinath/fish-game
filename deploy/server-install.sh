#!/usr/bin/env bash
# Fish.IO server installer — run ON THE VPS as root.
#
# Assumes the repository tree has been unpacked at /opt/fishio/app
# (see deploy/README.md). Idempotent: safe to re-run for updates.
#
# It does NOT touch existing services or the existing Caddy sites.
set -euo pipefail

APP_DIR="${FISHIO_APP_DIR:-/opt/fishio/app}"
APP_USER="${FISHIO_USER:-fishio}"
ROOT_DIR="${FISHIO_ROOT_DIR:-/opt/fishio}"

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root" >&2
  exit 1
fi
if [ ! -d "$APP_DIR/apps/api" ]; then
  echo "error: app tree not found at $APP_DIR (unpack the tarball there first)" >&2
  exit 1
fi

# --- Node runtime: use system node >= 20, otherwise install a private Node 22 ---
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ]; then
      return 0
    fi
    echo "[fishio] system node is too old ($(node -v)) — installing private Node 22 under $ROOT_DIR/node"
  else
    echo "[fishio] node not found — installing private Node 22 under $ROOT_DIR/node"
  fi

  local arch node_arch listing url tmp
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64) node_arch="x64" ;;
    aarch64 | arm64) node_arch="arm64" ;;
    *)
      echo "error: unsupported architecture $arch" >&2
      exit 1
      ;;
  esac

  command -v curl >/dev/null 2>&1 || {
    echo "error: curl is required to download Node" >&2
    exit 1
  }
  listing="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/)"
  url="$(printf '%s' "$listing" | grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${node_arch}\.tar\.xz" | head -1)"
  if [ -z "$url" ]; then
    echo "error: could not locate a Node 22 build for linux-${node_arch}" >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/${url}" -o "$tmp/node.tar.xz"
  tar -xJf "$tmp/node.tar.xz" -C "$tmp"
  mkdir -p "$ROOT_DIR/node"
  cp -a "$tmp/${url%.tar.xz}/." "$ROOT_DIR/node/"
  rm -rf "$tmp"
  echo "[fishio] installed $("$ROOT_DIR/node/bin/node" -v) at $ROOT_DIR/node"
}
ensure_node
export PATH="$ROOT_DIR/node/bin:$PATH"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node >= 20 required (found $(node -v))" >&2
  exit 1
fi

# Dedicated unprivileged user (no login shell).
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "[fishio] created system user $APP_USER"
fi

mkdir -p "$APP_DIR/apps/api/data" "$ROOT_DIR/tmp"
chown -R "$APP_USER:$APP_USER" "$ROOT_DIR"
chmod 750 "$ROOT_DIR"

# Env files are never overwritten — create from templates on first install.
for f in apps/api/.env apps/room-server/.env; do
  if [ ! -f "$APP_DIR/$f" ]; then
    if [ -f "$APP_DIR/$f.production.example" ]; then
      cp "$APP_DIR/$f.production.example" "$APP_DIR/$f"
      chown "$APP_USER:$APP_USER" "$APP_DIR/$f"
      chmod 600 "$APP_DIR/$f"
      echo "[fishio] created $APP_DIR/$f from template — REVIEW IT (ports, WEB_ORIGIN, secrets)"
    else
      echo "[fishio] WARNING: $APP_DIR/$f is missing (no template to copy)"
    fi
  fi
done

# Dependencies (npm workspaces install from the repo root; tsx is the runtime).
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR/node_modules" 2>/dev/null || true

# Generate the internal HMAC secret used by room servers (M4) if still a placeholder.
if grep -q '^INTERNAL_HMAC_SECRET=replace-with-a-long-random-value' "$APP_DIR/apps/api/.env" 2>/dev/null; then
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  else
    SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  sed -i "s|^INTERNAL_HMAC_SECRET=.*|INTERNAL_HMAC_SECRET=${SECRET}|" "$APP_DIR/apps/api/.env"
  echo "[fishio] generated INTERNAL_HMAC_SECRET"
fi

# systemd units.
install -m 644 "$APP_DIR/deploy/systemd/fishio-api.service" /etc/systemd/system/fishio-api.service
install -m 644 "$APP_DIR/deploy/systemd/fishio-room.service" /etc/systemd/system/fishio-room.service
systemctl daemon-reload
systemctl enable --now fishio-api.service fishio-room.service
sleep 2

API_PORT="$(sed -n 's/^PORT=//p' "$APP_DIR/apps/api/.env" 2>/dev/null | tail -1)"
ROOM_PORT="$(sed -n 's/^ROOM_PORT=//p' "$APP_DIR/apps/room-server/.env" 2>/dev/null | tail -1)"
API_PORT="${API_PORT:-18080}"
ROOM_PORT="${ROOM_PORT:-18787}"

echo "[fishio] service status:"
systemctl --no-pager --lines=0 status fishio-api fishio-room || true
echo "[fishio] health checks:"
curl -fsS "http://127.0.0.1:${API_PORT}/healthz" || echo "  API not responding yet — inspect: journalctl -u fishio-api -n 50"
echo
curl -fsS "http://127.0.0.1:${ROOM_PORT}/healthz" || echo "  room not responding yet — inspect: journalctl -u fishio-room -n 50"
echo
echo "[fishio] done. To expose through the existing Caddy (do NOT edit existing site blocks):"
echo "  cp $APP_DIR/deploy/Caddyfile.fishio /etc/caddy/conf.d/fishio.caddy   # adjust path to your Caddy conf.d"
echo "  # edit domains inside, then:"
echo "  caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"
