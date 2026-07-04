# AS Bump Maker

A browser-based tool for building short "bump" videos — drop in an audio track and a background, tweak text/timing, and export an MP4. All rendering happens client-side via [`@ffmpeg/ffmpeg`](https://ffmpegwasm.netlify.app/) (WebAssembly); the server does nothing but ship the static assets.

## Requirements

- Docker (or Docker + Compose)
- A modern browser with `SharedArrayBuffer` support (Chrome, Firefox, Safari 15+, Edge)

The app requires `SharedArrayBuffer` for FFmpeg's multi-threaded WASM build, which is why nginx sets the COOP/COEP headers in `default.conf`. Loading `index.html` directly from disk (`file://`) will **not** work — you need to serve it over HTTP with the cross-origin isolation headers set.

COEP is set to `credentialless` (not `require-corp`) so the app can fetch audio from third-party URLs without those hosts having to opt in via `Cross-Origin-Resource-Policy` headers. This keeps `SharedArrayBuffer` available while enabling the "Load from URL" audio source. Trade-off: `credentialless` requires Chrome 96+ / Firefox 119+ / Safari 17.4+.

## Run

With Docker Compose:

```sh
docker compose up -d
# open http://localhost:8080
```

Or with plain Docker:

```sh
docker build -t as-bump-maker .
docker run --rm -p 8080:80 as-bump-maker
```

Stop:

```sh
docker compose down
```

## Development

The app is three static files served by nginx — no build step. Edit `index.html`, `app.js`, or `style.css`, then rebuild:

```sh
docker compose up -d --build
```

If you want a faster iteration loop, mount the source into the running container instead of rebuilding:

```sh
docker run --rm -p 8080:80 \
  -v "$(pwd)/index.html:/usr/share/nginx/html/index.html:ro" \
  -v "$(pwd)/app.js:/usr/share/nginx/html/app.js:ro" \
  -v "$(pwd)/style.css:/usr/share/nginx/html/style.css:ro" \
  as-bump-maker
```

## Project layout

```
.
├── Dockerfile          # nginx:1.27-alpine + custom conf + assets
├── docker-compose.yml  # single "web" service, 8080:80
├── default.conf        # nginx server block (SPA fallback, COOP/COEP headers)
├── index.html          # markup
├── app.js              # UI + FFmpeg WASM export pipeline
├── style.css           # styles
└── LICENSE
```

## Notes

- **OrbStack users:** on container start you may see `[emerg] io_setup() failed (38: Function not implemented)` lines from every nginx worker. This is cosmetic — OrbStack's kernel omits the Linux AIO syscalls, but nginx disables its AIO path for that worker and continues serving normally. The site works. Docker Desktop's kernel does not have this quirk.
- **FFmpeg WASM assets** are loaded from the jsDelivr CDN at runtime (see the `import` at the top of `app.js`), not bundled into the image. First page load will fetch ~30MB of WASM.
- The server is intentionally minimal — no proxying, no TLS, no gzip. If you deploy this behind a reverse proxy, make sure the proxy preserves (or re-adds) the COOP/COEP/CORP headers or the app will silently fall back to a broken state.

## Deploying

See [`deploy/README.md`](deploy/README.md) for the production runbook: Caddy in front for auto-TLS, app pulled from GHCR, tested on Hetzner but works on any Linux box with Docker + ports 80/443 open.

## Contributing

Direct pushes to `main` are blocked; changes go through PRs. The CI Docker build must pass, and every PR must go through a local `/codex review` gate before merge. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
