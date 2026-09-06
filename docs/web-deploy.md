# GEREH - Web Deploy Checklist

## 1) Production Environment

Use `.env.production.example` as base:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=8100`
- `NP_LICENSE_ALLOWED=1` (required for the free beta; desktop licensing is not used)
- `JWT_SECRET` (required; use a long random value)
- `POPPLER_PATH` (required if PDF processing is used)

## 2) Build

```bash
npm install
npm run check
npm run build
```

## 3) Start (Production)

```bash
npm run start:prod
```

If reverse proxy is used (Nginx/Caddy), route HTTP traffic to `127.0.0.1:8100`.

## 4) Smoke Test

Basic API checks:

```bash
npm run smoke:web
```

Without credentials, the smoke test verifies that protected pattern APIs reject
anonymous requests. To test an authenticated session, provide an existing beta
user's JWT through `SMOKE_TEST_TOKEN`.

Optional upload test:

```bash
SMOKE_TEST_IMAGE=./some-test.png npm run smoke:web
```

## 5) Required Runtime Dependencies

- Node.js runtime compatible with current native modules
- `better-sqlite3` runtime support
- `sharp` runtime support
- Poppler binaries for PDF rasterization (`pdftoppm`)

## 6) Storage Notes (Important)

Current app writes to local folders:

- `uploads/`
- `public/processed/`
- `neural.db` (SQLite)

For temporary 1-month web usage, single-node deployment is acceptable.
For long-term/multi-node deployment, move to:

- object storage (S3-compatible) for files
- managed SQL database (PostgreSQL) for persistence

## 7) Rollback Plan

- Keep previous build artifact (`dist/`) and previous `.env`.
- If deploy fails:
1. stop current process
2. restore previous artifact
3. restart with previous env

## 8) Pre-Release Gate

Deploy only if all are true:

1. `npm run check` passes
2. `npm run build` passes
3. `npm run smoke:web` passes
4. PDF upload test passes on target host
