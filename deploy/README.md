# Deploying to a Linux box (Hetzner or similar)

Runs the bump maker behind Caddy for auto-TLS and HTTPS. Pulls the app image from GHCR, so the box does zero building — every image running here is exactly the one CI built and published.

## Prerequisites

On the box:

- Docker Engine + the Compose plugin. On Debian/Ubuntu:
  ```sh
  curl -fsSL https://get.docker.com | sh
  ```
- Ports **80** and **443** open to the internet. If you use Hetzner Cloud Firewall (or any host firewall), allow inbound TCP 80, 443, and UDP 443 (HTTP/3).
- A DNS **A record** for the hostname you want, pointing at the box's public IPv4. (Optional: an **AAAA record** for IPv6 if the box has one.)

Locally (once, before your first deploy):

- **Make the GHCR image public** so the box can pull it without auth. Visit:  
  <https://github.com/users/keif/packages/container/as-bump-maker/settings>  
  → scroll to **Danger Zone** → **Change visibility** → **Public** → confirm.  
  (GitHub's REST API doesn't expose this for user-owned packages; it has to be a UI click.)  
  Alternatively, keep it private and `docker login ghcr.io` on the box with a personal access token that has `read:packages`. Public is simpler and matches the fact that the source repo is already public.

## First deploy

```sh
# On the box:
git clone https://github.com/keif/as-bump-maker.git
cd as-bump-maker/deploy

# Edit the Caddyfile — replace {{DOMAIN}} with your hostname:
sed -i 's/{{DOMAIN}}/bump.yourdomain.com/' Caddyfile
# (or open in your editor of choice)

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

## Updates

CI publishes `ghcr.io/keif/as-bump-maker:latest` on every merge to `main`. To pick up the newest image:

```sh
cd ~/as-bump-maker/deploy
docker compose pull
docker compose up -d
```

That's a five-second reload — Caddy stays up throughout, and the `web` container is replaced with the new image.

For an even lower-touch flow, [Watchtower](https://containrrr.dev/watchtower/) can auto-pull and restart when new images land. Not enabled here by default — explicit updates are safer for a hobby box.

## Rollback

Every merge to `main` also publishes an immutable `:<sha>` tag. To roll back:

```sh
# Edit docker-compose.yml, change:
#   image: ghcr.io/keif/as-bump-maker:latest
# to:
#   image: ghcr.io/keif/as-bump-maker:<git-sha-of-known-good-commit>

docker compose pull
docker compose up -d
```

Then commit the compose change so future deploys stay pinned until you re-flip to `:latest`.

## What's running

- **`caddy`** — Caddy 2 on alpine. Terminates TLS, reverse-proxies to `web:80`, listens on 80/443 (TCP+UDP). Handles Let's Encrypt automatically. Persists certs in the `caddy_data` volume so restarts don't re-provision.
- **`web`** — the bump maker app (nginx 1.27-alpine + our static assets). No published port — reachable only from Caddy over the `proxy` docker network. Sets COOP / COEP: credentialless / CORP response headers; Caddy passes them through unchanged, so `SharedArrayBuffer` + ffmpeg-wasm work in the browser.

## Adding more sites later

The Caddyfile pattern scales: each additional site is another block. Example — one bump maker plus another static site:

```
bump.yourdomain.com {
    reverse_proxy web:80
}

blog.yourdomain.com {
    reverse_proxy blog:80
}
```

Add the matching service to `docker-compose.yml` (join the `proxy` network), reload, and Caddy provisions a new cert on the fly.

## Troubleshooting

**"unable to get initial certificate"** — DNS isn't pointing at the box yet, or the box's port 80 isn't reachable from Let's Encrypt's validators (firewall?). Verify with `dig +short yourdomain.com` and `curl -v http://<box-ip>` from a different machine.

**`ImagePullBackOff` / "unauthorized"** — the GHCR image is still private. Either flip it to public (see Prerequisites) or `docker login ghcr.io` on the box.

**502 Bad Gateway from Caddy** — the `web` container is unhealthy or stopped. Check `docker compose logs web`.

**HTTP/3 not working** — some ISPs block UDP 443. HTTP/2 will still serve everything correctly, so this is cosmetic. To disable HTTP/3 explicitly, add `servers { protocols h1 h2 }` to the Caddyfile global block.
