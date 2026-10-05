# Fish.IO deployment runbook

Split deployment:

```
            Vercel (HTTPS, static)                 VPS 69.62.81.172 (existing Caddy)
   ┌─────────────────────────────┐        ┌──────────────────────────────────────────┐
   │ apps/web (the game)         │        │  api.example.com  → 127.0.0.1:18080 (API)│
   │  + config.js                │──HTTPS─▶  room.example.com → 127.0.0.1:18787 (room)│
   │  ? room/api URLs            │──WSS───▶  fishio-api.service / fishio-room.service  │
   └─────────────────────────────┘        └──────────────────────────────────────────┘
```

- **Vercel** serves only static files — it cannot run the room server (persistent WebSocket
  process) or the API (SQLite writes, Hedera keys). Those live on the VPS.
- The VPS already runs **Caddy on 80/443**; we add two *new* reverse-proxy sites to it.
  **Existing sites/processes are never edited or restarted** — only `caddy reload`.

Ports chosen to avoid collisions: API `18080`, room `18787` (loopback only).

---

## 0. Recon before touching anything (read-only)

```bash
ssh <host>
uname -a; free -m; nproc; df -h /
node -v || echo "node missing"
ss -tlnp | grep -E ':(80|443|18080|18787)\b'
systemctl list-units --type=service --state=running | grep -Ei 'caddy|nginx|node|docker'
ls /etc/caddy/ 2>/dev/null; grep -R "import" /etc/caddy/Caddyfile 2>/dev/null
```

Note where Caddy keeps its config (often `/etc/caddy/Caddyfile` plus `conf.d/` or `sites/`).
Do not start/stop existing services.

## 1. Deploy the code

From a machine that can SSH to the server:

```powershell
pwsh deploy/package-and-upload.ps1 -Server 69.62.81.172            # port 22
pwsh deploy/package-and-upload.ps1 -Server 69.62.81.172 -Port 2222 # custom port
```

This tars the repo (no `.env`, no SQLite data, no `node_modules`), uploads to `/tmp`,
unpacks to `/opt/fishio/app`, then runs `deploy/server-install.sh` which:

1. creates the unprivileged `fishio` system user + `/opt/fishio`
2. installs dependencies (npm workspaces from the repo root)
3. creates `apps/{api,room-server}/.env` from `*.production.example` on first install
4. installs and starts `fishio-api.service` + `fishio-room.service`
5. health-checks `127.0.0.1:18080/healthz` and `127.0.0.1:18787/healthz`

Re-running the script is the update path (same steps, `.env` preserved, services restarted).

> Alternative without SSH from your machine: push the repo to GitHub, then on the server
> `git clone` into `/opt/fishio/app` and run `bash deploy/server-install.sh`.

### 1b. No SSH? Deploy from the provider's web console

SSH port 22 and 80/443 are different beasts: if your local network blocks SSH, the hoster's
web console still works. Paste this into the console (root shell):

```bash
set -e
mkdir -p /opt
if [ ! -d /opt/fishio/app/.git ]; then
  git clone https://github.com/shripad-jyothinath/fish-game.git /opt/fishio/app
else
  git -C /opt/fishio/app pull --ff-only
fi
bash /opt/fishio/app/deploy/server-install.sh
```

The installer is self-contained: it creates the `fishio` user, installs a private Node 22
under `/opt/fishio/node` when the system Node is missing/too old, installs dependencies,
starts both systemd units on 127.0.0.1:18080/18787 and health-checks them.

Then expose them through the existing Caddy. **No DNS needed for the first deployment** —
sslip.io names resolve to the IP automatically:

```bash
bash /opt/fishio/app/deploy/setup-caddy.sh \
  api.69-62-81-172.sslip.io \
  room.69-62-81-172.sslip.io
```

`setup-caddy.sh` writes `/etc/caddy/fishio.caddy`, adds one `import` line with a timestamped
backup, validates with `caddy validate`, rolls back on error and then `systemctl reload caddy`
(never a restart). Existing sites are untouched.

Verify from any machine:

```bash
curl -s https://api.69-62-81-172.sslip.io/healthz
curl -s https://room.69-62-81-172.sslip.io/healthz
```

After the Vercel URL is known, set it as the allowed browser origin (console one-liner):

```bash
sed -i 's|^WEB_ORIGIN=.*|WEB_ORIGIN=https://your-game.vercel.app|' /opt/fishio/app/apps/api/.env
systemctl restart fishio-api
```


## 2. Configure the env files (on the server)

`/opt/fishio/app/apps/api/.env`:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=18080
WEB_ORIGIN=https://<your-vercel-app>.vercel.app,https://<your-domain>
INTERNAL_HMAC_SECRET=<long random string>
# + copy the Hedera values from your local apps/api/.env (operator key, token/topic/NFT ids,
#   WALLET_ENCRYPTION_KEY, ...). Never commit these.
```

`/opt/fishio/app/apps/room-server/.env`:

```env
ROOM_HOST=127.0.0.1
ROOM_PORT=18787
ROOM_NAME=reef-1
ROOM_MAX_PLAYERS=32
```

Then: `systemctl restart fishio-api fishio-room` (only these two units).

## 3. TLS + routing with the existing Caddy

1. Copy `deploy/Caddyfile.fishio` into Caddy's conf.d (path from recon), edit the domains:

   ```caddy
   api.<your-domain>  { reverse_proxy 127.0.0.1:18080 }
   room.<your-domain> { reverse_proxy 127.0.0.1:18787 }
   ```

2. Make sure both DNS names point at `69.62.81.172` (Caddy will get Let's Encrypt certs).
3. `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`
   (`reload` — never `restart` — keeps existing sites alive.)

If the Caddyfile doesn't `import` a conf.d directory, add the two site blocks to the end
of the existing file instead — still a reload, not a restart.

## 4. Vercel (frontend)

1. Import the GitHub repo in Vercel.
2. **Root Directory: `apps/web`** · Framework Preset: Other · Build Command: *(empty)* ·
   Output Directory: `.` (the repo ships `apps/web/vercel.json`).
3. Deploy. You get `https://<project>.vercel.app`.
4. Point the game at the VPS backend — edit `apps/web/config.js` (or inject at build):

   ```js
   window.FISHIO_API_BASE = 'https://api.<your-domain>';
   window.FISHIO_ROOM_URL = 'wss://room.<your-domain>';
   ```

   For quick tests you can also use `?api=https://…&room=wss://…` on the URL.
5. Add the final Vercel origin(s) to `WEB_ORIGIN` in the API env and restart `fishio-api`
   (cookies switch to `SameSite=None; Secure` automatically when `WEB_ORIGIN` is set).

## 5. Verify

```bash
curl -s https://api.<domain>/healthz
curl -s https://room.<domain>/healthz
# CORS preflight from the Vercel origin:
curl -s -i -X OPTIONS https://api.<domain>/api/v1/auth/me \
  -H "Origin: https://<project>.vercel.app" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control
```

Browser: open the Vercel URL in two tabs → **PLAY ONLINE 🌐**; both fish should see each
other; check `/healthz` on the room server for `online: 2`.

## 6. Updates & rollback

- Update: re-run `deploy/package-and-upload.ps1` (or `git pull` on the server + `bash deploy/server-install.sh`).
- Logs: `journalctl -u fishio-api -f` / `journalctl -u fishio-room -f`.
- Rollback: keep the previous tarball, unpack it back into `/opt/fishio/app` and re-run the
  installer; `.env` is never overwritten.
- The SQLite DB lives at `/opt/fishio/app/apps/api/data/fishio.db` (owned by `fishio`).
  Back it up before bigger updates: `cp --reflink=auto fishio.db fishio.db.bak`.
