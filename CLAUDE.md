# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A WhatsApp bot + admin panel for managing a recurring pickup soccer game ("fut"): opens attendance polls, tracks who's a monthly payer (mensalista) vs. drop-in (avulso), balances teams, and reads payment receipts (comprovantes) sent as images via OCR to auto-mark payments.

## Commands

There is no build step, linter, or test suite configured (`npm test` is a placeholder).

- `npm install` — runs `patch-package` automatically via `postinstall` (see whatsapp-web.js patch below).
- `node index.js` — runs the WhatsApp bot (prints a QR code to the terminal on first run; session persists via `LocalAuth` in `.wwebjs_auth/`).
- `node panel/server.js` — runs the admin web panel (Express + EJS) on `PORT` (default 4000).
- In production (Docker/Fly) both run together via `docker-entrypoint.sh`, which `wait -n`s on both — if either process dies, the other is killed too and the container restarts.
- Deploy: `fly deploy` (app `fut-whatsapp-bot`, region `gru`). It builds the Docker image from the local working tree directly — no need to commit/push first.

### Required env vars (`.env`, not committed)

`SESSION_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD`, `PORT` are read by `panel/server.js`. `GRUPO_OFICIAL_ID`/`GRUPO_TESTE_ID` exist in `.env` but nothing in the code currently reads them — the group to use is instead picked at runtime via the panel (`enquete_grupo_id` config, set the first time `!enquete` runs in a group, or picked from the synced group list).

## Architecture

### Two processes, one SQLite database

- `index.js` — the WhatsApp bot, built on `whatsapp-web.js` (puppeteer-driven WhatsApp Web client). Owns the `client.on('message', ...)` handler, poll (`enquete`) lifecycle, scheduled messages, and receipt OCR.
- `panel/server.js` — the admin panel. Express + EJS views in `panel/views/`, session-authenticated (single admin login, bootstrapped from `ADMIN_USER`/`ADMIN_PASSWORD` on first run). Sessions are stored in the same SQLite DB via `panel/sqlite-session-store.js` (not the default in-memory store) so logins survive process restarts.
- `db.js` — the shared data layer (better-sqlite3, synchronous). Both processes require it directly and call its exported functions; there is no API boundary between bot and panel, just this shared module. Table set includes `jogadores` (players), `enquetes`/`votos`/`enquete_opcoes` (polls), `pagamentos`/`pagamentos_avulsos` (payments), `configuracoes` (key/value config), `logs`, `mensagens_agendadas`, `papel_historico`, `sessions`, `grupos`, `avaliacoes`.
- `mensagens-prontas.js` — pure text/formatting helpers shared by both processes: team balancing (`balancearTimes`) and building the WhatsApp message text for confirmed lists / team lineups.

### Persistence on Fly.io

`fly.toml` mounts a volume at `/app/storage`. `docker-entrypoint.sh` symlinks `/app/data` and `/app/.wwebjs_auth` into it before starting anything, so the SQLite DB and the WhatsApp login session survive deploys and restarts. Don't assume `/app/data` or `/app/.wwebjs_auth` are ephemeral — writes there are persistent in production.

### Config lives in the DB, not in code

All bot behavior (poll schedule, title template, payment amounts, vacancy limits, auto-close, command whitelist) is driven by the SQLite `configuracoes` key/value table, read/written via `getConfig`/`setConfig` in `db.js`. There is no in-code per-group config object — an earlier prototype (`groupConfigs`, reaction-based confirmation, mock player levels) was removed as dead code; don't reintroduce that pattern.

### Command authorization

Commands (`!lista`, `!fechar`, `!espera`, `!times`, `!enquete`, `!sincronizar`) are gated by `remetenteAutorizado(msg)` → `podeUsarComandos(idCanonico)`, which checks a per-player whitelist maintained in the panel ("Comandos" page), not simply group membership.

### Group vs. DM handling gotcha

Several bot features are meant to work both inside the WhatsApp group and in a direct message to the bot's own number (marked in code with the comment "funciona em grupo OU em DM direto com o bot"). Do not gate such handlers on `msg.from.endsWith('@g.us')` — that check silently swallows DMs with no log/error, since the gated function is simply never invoked. This is a real bug pattern that has bitten this codebase before (receipt-image handling in `index.js` was originally group-only by accident).

### Receipt OCR (comprovante) flow

`processarPossivelComprovante` in `index.js` runs `tesseract.js` (WASM, no external shell-out) on incoming images. It only acts if OCR text contains both a payment keyword (`PALAVRAS_COMPROVANTE`) and an `R$` amount — otherwise it's silently ignored (assumed to be an unrelated photo/meme) or logged as an unconfirmed guess. The extracted `R$` value is matched against the configured `valor_mensal`/`valor_avulso` (panel → Jogo → Valores) to decide whether it's a monthly or drop-in payment — the receipt's amount decides the payment type, not the player's registered role. All outcomes (success, ambiguous, sender not on roster, amount mismatch) go through `registrarLog`, visible on the panel's Logs page.

### whatsapp-web.js is patched

`patches/whatsapp-web.js+1.34.7.patch` fixes poll-vote message lookup in the vendored library (applied automatically by `patch-package` via the `postinstall` script). If `whatsapp-web.js` is ever upgraded or reinstalled, the patch must be reconciled/regenerated, not silently dropped.

### Timezone

Both `index.js` and `panel/server.js` force `process.env.TZ = 'America/Sao_Paulo'` at the very top, before anything else runs. All date/day-of-week logic (poll scheduling, "which month is this payment for", weekly messages) assumes Brasília local time.

### Non-root container

The Dockerfile installs `gosu`; `docker-entrypoint.sh` runs as root only long enough to symlink/`chown` the Fly volume (`/app/storage`), then drops to the unprivileged `node` user (via `gosu node`) to actually run `index.js`, `panel/server.js`, and the Chromium instance underneath. New processes/services started from the entrypoint must follow the same pattern — don't add a bare `node ...` line there without the `gosu node` prefix, or it'll run as root.

### CSRF protection is manual, per-form

`csurf` is deprecated, so CSRF uses a hand-rolled synchronizer token: `panel/server.js` generates a random token per session (`req.session.csrfToken`), exposes it as `csrfToken` to every view, and a global middleware rejects any POST whose body's `_csrf` doesn't match. **Every new `<form method="post">` in `panel/views/` must include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`** or it will get a 403. The one exception is multipart forms (`enctype="multipart/form-data"`, currently only the logo upload) — the global middleware skips those because `express.urlencoded` can't parse multipart bodies, so the route itself re-checks the token after `multer` runs; follow that same pattern for any future file-upload route.

### Helmet is on, CSP is off

`panel/server.js` uses `helmet({ contentSecurityPolicy: false })`. CSP is explicitly disabled because most views have inline `<script>` blocks with no nonce — enabling the default CSP would silently break them. The other headers (frame options, no-sniff, HSTS, etc.) are active.

### Secure session cookie needs the proxy headers

The session cookie is `secure: true` + `sameSite: 'lax'`, and `app.set('trust proxy', 1)` is set so Express trusts Fly's `X-Forwarded-Proto` header to know the original request was HTTPS. `fly.toml`'s port-80 listener also sets `force_https = true`. If any of these three pieces (trust proxy, force_https, secure cookie) is removed independently of the others, login can silently break (server won't set the session cookie at all if it doesn't believe the connection is secure).
