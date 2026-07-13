# Deploying

Two paths depending on your infra:

- **[Coolify](#coolify)** — if you already run [Coolify](https://coolify.io) (self-hosted PaaS) on your box. ~2 minutes, all in the UI. Coolify handles TLS, reverse proxy, and lifecycle.
- **[Caddy from scratch](#caddy-from-scratch)** — if you're deploying to a bare Linux box with no PaaS. You get a docker-compose file + Caddyfile in this directory and a runbook.

Both paths pull the same image from GHCR (`ghcr.io/keif/as-bump-maker:latest`), so the "make image public" prerequisite applies to both.

---

## Prerequisites (both paths)

1. **Public GHCR image** so the box can pull without auth. Flip visibility here:
   <https://github.com/users/keif/packages/container/as-bump-maker/settings>
   → **Danger Zone** → **Change visibility** → **Public** → confirm.
   (GitHub's REST API doesn't expose this for user-owned packages; must be a UI click. Alternative: keep private and configure a `docker login ghcr.io` on the host with a `read:packages` PAT.)

2. **DNS A record** for the hostname you want, pointing at your box's public IPv4. Optional AAAA if the box has IPv6.

3. **Ports 80 + 443 (TCP) + 443 (UDP for HTTP/3)** open on the host firewall. If you use Hetzner Cloud Firewall, allow all three.

---

## Coolify

Coolify runs Traefik under the hood for reverse proxy + auto-TLS, so you don't need the Caddyfile / compose bundle from this repo.

### First deploy

1. In Coolify → your project → **+ New Resource** → **Docker Image**.
2. **Docker Image**: `ghcr.io/keif/as-bump-maker:latest`.
3. **Domains**: `bump.yourdomain.com` (whatever hostname you set up in DNS).
4. **Ports Exposes**: `80` — the internal port nginx listens on.
5. Click **Deploy**.

Coolify pulls the image, wires up Traefik, provisions the TLS cert, and routes traffic. First-time TLS takes ~10-30s. Visit your domain when the deployment says healthy.

The app's nginx sets `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy: credentialless`, and `Cross-Origin-Resource-Policy` as response headers. Traefik passes them through unchanged, so `SharedArrayBuffer` (required for ffmpeg-wasm export) works in the browser. If exports hang, check the network tab for those headers on `/index.html`.

### Auto-redeploy on push to main

CI publishes `ghcr.io/keif/as-bump-maker:latest` on every merge to `main`. To have Coolify pull the fresh image without a manual click:

1. In Coolify → your app resource → **Webhooks** tab (naming varies by version — look for "Deployment Webhook" or "Deploy hook").
2. Copy the deploy URL (contains an embedded auth token — treat it like a secret).
3. In GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `COOLIFY_WEBHOOK_URL`
   - Value: paste the URL from step 2.

That's it. The Docker workflow already has a step that fires this webhook after every successful GHCR push. If the secret isn't set, the step logs a message and skips — safe for anyone forking this repo who doesn't use Coolify.

### Rollback in Coolify

Coolify has a **Deployments** history per resource. Click a prior deployment → **Redeploy**. Or, pin to a specific image tag in the resource settings (`ghcr.io/keif/as-bump-maker:<sha>` — every merge to `main` publishes an immutable `:<sha>` tag alongside `:latest`).

---

## Caddy from scratch

Use this path if you have a bare Linux box (Hetzner, DigitalOcean, EC2, whatever) with no PaaS in front. You'll run Caddy + the app as two docker-compose services, and Caddy handles TLS + reverse proxy.

### First deploy

```sh
# On the box:
curl -fsSL https://get.docker.com | sh   # if Docker isn't already installed
git clone https://github.com/keif/as-bump-maker.git
cd as-bump-maker/deploy

# Edit the Caddyfile — replace {{DOMAIN}} with your hostname.
# Use your editor of choice:
nano Caddyfile   # or vim, vi, whatever

# Or, if you'd rather do it in one command, this works on Linux (GNU sed).
# On macOS BSD sed you'd need `sed -i '' ...` — the -i flag semantics differ.
sed -i 's/{{DOMAIN}}/bump.yourdomain.com/' Caddyfile

# Confirm DNS is live BEFORE starting — Caddy tries ACME immediately:
dig +short bump.yourdomain.com
# Should return your box's public IP. If it returns nothing, wait for
# DNS propagation before proceeding.

# Start the stack:
docker compose up -d

# Watch Caddy provision the TLS cert (takes 10-30s on first run):
docker compose logs -f caddy
# You want to see: "certificate obtained successfully"
```

Then visit `https://bump.yourdomain.com` — the app should load with a valid cert.

### Updates

```sh
cd ~/as-bump-maker/deploy
docker compose pull
docker compose up -d
```

Five-second reload — Caddy stays up throughout, the `web` container is replaced with the new image.

For zero-touch updates, run [Watchtower](https://containrrr.dev/watchtower/) alongside. Not enabled here by default; explicit updates are safer on a hobby box.

### Rollback

Every merge to `main` publishes an immutable `:<sha>` tag alongside `:latest`. To pin:

```yaml
# Edit deploy/docker-compose.yml
services:
  web:
    image: ghcr.io/keif/as-bump-maker:<git-sha-of-known-good-commit>
```

Then `docker compose pull && docker compose up -d`. Commit the change so future deploys stay pinned until you re-flip to `:latest`.

### What's running

- **`caddy`** — Caddy 2 on alpine. Terminates TLS, reverse-proxies to `web:80`, listens on 80/443 (TCP+UDP). Handles Let's Encrypt automatically. Certs persist in the `caddy_data` volume so restarts don't re-provision.
- **`web`** — the bump maker app (nginx 1.27-alpine + our static assets). No published port — reachable only from Caddy over the `proxy` docker network. Sets COOP / COEP: credentialless / CORP response headers; Caddy passes them through unchanged.

### Adding more sites later

Each additional site is another block in the Caddyfile:

```
bump.yourdomain.com {
    reverse_proxy web:80
}

blog.yourdomain.com {
    reverse_proxy blog:80
}
```

Add the matching service to `docker-compose.yml` (join the `proxy` network), reload, and Caddy provisions a new cert on the fly.

### Troubleshooting

**"unable to get initial certificate"** — DNS isn't pointing at the box yet, or the box's port 80 isn't reachable from Let's Encrypt's validators (firewall?). Verify with `dig +short yourdomain.com` and `curl -v http://<box-ip>` from a different machine.

**`ImagePullBackOff` / "unauthorized"** — the GHCR image is still private. Either flip it to public (see Prerequisites) or `docker login ghcr.io` on the box.

**502 Bad Gateway from Caddy** — the `web` container is unhealthy or stopped. Check `docker compose logs web`.

**HTTP/3 not working** — some ISPs block UDP 443. HTTP/2 will still serve everything correctly, so this is cosmetic. To disable HTTP/3 explicitly, add `servers { protocols h1 h2 }` to the Caddyfile global block.
