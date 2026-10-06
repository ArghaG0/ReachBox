# ReachBox email scheduler

Phases 1-3 are implemented: PostgreSQL/Prisma, Redis/BullMQ, Ethereal provisioning, scheduling, atomic claims, SMTP retries, and restart reconciliation. The frontend remains in `Frontend/`. See [the implementation plan](docs/backend_implementation_plan.md).

This is still an intermediate service. Hourly limiting/pacing, Bull Board, Elasticsearch indexing/search, read APIs, Google OAuth, and Slack remain pending. The live scheduling API deliberately returns 401 until authentication is implemented. Tests inject an owner without introducing a public bypass.

## Local setup

Use Node 20.19+ for the backend, Docker Compose v2, npm, and Bun for the existing frontend. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

For a fresh checkout, copy the example environment files without overwriting existing customized files:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
npm.cmd ci
docker compose up -d --wait
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
```

Root `.env` configures Compose; `backend/.env` configures Node. Defaults match the local Docker credentials/ports. Keep database/Redis URLs consistent when changing them. PostgreSQL, Redis AOF with no-eviction, and Elasticsearch use named volumes and bind to loopback. Elasticsearch security is disabled for local development only.

The root npm workspace includes `backend/` and shares `package-lock.json` and hoisted dependencies. The frontend keeps its separate Bun setup. Root `.npmrc` avoids npm 10's optional-peer resolver failure. Prisma's configuration dependency `deepmerge-ts` is overridden to a patched version and verified with migration/generation checks.

Run these in separate terminals:

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd run dev:worker
```

Compiled commands are `npm run start:api --workspace backend` and `npm run start:worker --workspace backend`. The API never launches a consumer. `GET /health` reports process liveness, not full dependency readiness.

## Scheduling and delivery

The existing schedule payload is unchanged:

```json
{
  "senderId": "an-owned-sender-uuid",
  "subject": "Hello",
  "bodyHtml": "<p>Hello!</p>",
  "recipients": ["one@example.com", "two@example.com"],
  "startAt": null,
  "delaySeconds": 5,
  "hourlyLimit": 100
}
```

The route returns `201 { campaignId, total, firstScheduledAt, lastScheduledAt }`, with ISO UTC timestamps. Errors are `{ error: string }`. Recipients are normalized, filtered, and deduplicated in order; at most 5,000 input recipients and at least one valid address are allowed. Ownership is checked in the same transaction that inserts the campaign and emails. Initial timestamps are `max(startAt, now) + index * delaySeconds * 1000`.

After commit, the producer uses chunked `addBulk` (500 by default) and payloads containing only `{ emailId }`. Database identity is `email:<uuid>`; queue identity is `email-<uuid>`, using one deterministic mapping helper. The worker loads content and SMTP credentials from PostgreSQL.

A 201 means durable database acceptance. Dispatch failures log `campaign_dispatch_pending`; worker boot or worker Redis reconnection restores the jobs. If only the API lost its Redis connection while workers stayed connected, restart a worker to trigger a scan. There is no periodic database polling and no need to resubmit the campaign.

## Phase 3 claims, retries, and recovery

- An atomic PostgreSQL update claims a due `scheduled` row as `sending` and increments `attempts`. Later writes require that claim version and state, preventing older claims from overwriting newer work.
- The new migration adds `failedAttempts`, a durable SMTP failure count. Transient failures restore `scheduled` with exponential backoff; exhaustion marks `failed`. Recreating a missing Redis job cannot reset this budget.
- Success saves `sentAt`, `messageId`, and `previewUrl` and clears the error. Sent/failed records are skipped on replay, including after completed queue entries are removed.
- Reconciliation runs before consumption, on worker Redis reconnect, and following worker failures. Scans use bounded UUID pagination and serialized execution per process. Independent workers can safely repeat the scan.
- Missing jobs are restored; retained completed/failed entries are repaired if the database still requires processing. Genuinely stale `sending` rows are reset only when no live BullMQ lock protects them.
- Fresh claims are preserved. If their queue entry is missing, a one-off delayed email job revisits them at the stale threshold. Existing jobs also honor persisted database timestamps, preventing early sends after a partial reschedule.
- Exhausted BullMQ stall failures become database failures. A failed reconciliation causes process exit so the container platform can restart it.
- Queue lock ownership is checked before SMTP and success recording. SMTP has an absolute deadline below the stale threshold. Graceful shutdown stops consumption, waits for active work and reconciliation, and closes connections.

New environment settings have backward-compatible defaults:

| Variable | Default |
| --- | --- |
| `SMTP_SEND_TIMEOUT_MS` | 60000 |
| `WORKER_LOCK_DURATION_MS` | 30000 |
| `WORKER_STALLED_INTERVAL_MS` | 30000 |
| `WORKER_MAX_STALLED_COUNT` | 2 |
| `RECONCILIATION_BATCH_SIZE` | 200 |
| `SHUTDOWN_TIMEOUT_MS` | 90000 |

Existing `STALE_CLAIM_MS` is 120000 and `JOB_ATTEMPTS` is 3. Existing environment files continue working; apply the new database migration before updated workers start. `attempts` counts claims, including crash recovery; `failedAttempts` counts SMTP failures.

SMTP acceptance and the success commit cannot be atomic. A crash after acceptance but before the database commit can still cause a duplicate during recovery. A deterministic Message-ID supports tracing, not recipient deduplication. The duration of this residual window is not guaranteed to be microseconds.

Scheduling uses BullMQ delayed jobs only. No cron, repeatable scheduler, or in-memory rate counter is used. BullMQ's unused repeat APIs bring a transitive cron-parser dependency. `MIN_SEND_DELAY_MS=2000` and hourly limits are configured/stored but are **not enforced until Phase 4**.

## Tests and recovery demonstration

All project-owned tests and helpers live under root `tests/`. With local PostgreSQL and Redis running:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:recovery
```

Integration tests cover concurrent atomic claims, transient retries, terminal failures, replay after success, queue timing, ownership, transaction rollback, bulk enqueueing, and independent API/worker processes.

The recovery suite kills a child worker after it claims an email, starts a replacement, verifies one SMTP delivery, and restarts again to verify no resend. It also covers missing jobs, fresh/stale/live claims, concurrent scans, retained terminal queue entries, retry-budget preservation, and exhausted stalls. The tests use a loopback SMTP server, unique PostgreSQL schemas and queue prefixes, and clean up only their own resources. No OAuth or Ethereal credentials are needed. Override `TEST_DATABASE_URL`/`TEST_REDIS_URL` if using dedicated test services.

Run only the process crash scenario:

```powershell
npm.cmd run test:recovery -- -t "recovers a worker killed"
```

For existing development records, restart `npm.cmd run dev:worker` and observe `reconciliation_complete` before `worker_ready`. Inspect `Email.status`, `attempts`, `failedAttempts`, and `sentAt` using `npm.cmd exec --workspace backend -- prisma studio`. Fresh claims may wait up to the stale threshold; active locks are preserved. Public curl/Postman scheduling is still unavailable until OAuth; the tests provide repeatable scheduling fixtures.

Frontend checks:

```powershell
cd Frontend
bun install --frozen-lockfile
bun run test
bun run build
```

## Ethereal provisioning

For persistent senders, set `SEED_USER_ID` to an existing user's UUID and run `npm.cmd run db:seed`. The seed fills up to `SEED_SENDER_COUNT` (minimum two) without creating fake Google identities. Run one seed per owner at a time. Account caching is disabled before Nodemailer loads, so senders are distinct.

Until Google OAuth creates users, the explicit smoke test creates its own isolated user and sender accounts:

```powershell
npm.cmd run test:ethereal -- --reporter=verbose --silent=false
```

This requires outbound HTTPS and SMTP. Ethereal captures the message without delivering it to a real recipient. Open the printed `previewUrl`; persistent delivery URLs are stored on `Email`. Test database records are removed afterward. See [Ethereal testing](https://nodemailer.com/guides/testing-with-ethereal).

## Split deployment

Host `Frontend/` on Vercel. Host the API and worker as **two long-running container services** on Render, Railway, or an equivalent platform. Both share PostgreSQL, Redis, queue name/prefix, and backend configuration. Configure automatic worker restart. Repository changes prepare deployment; they do not publish services.

### Backend

The Dockerfile is in `backend/`, but the build context must be the **repository root**, because dependencies use the root workspace lockfile:

```sh
docker build -f backend/Dockerfile --target runtime -t reachbox-backend .
docker build -f backend/Dockerfile --target migrate -t reachbox-migrate .
```

The runtime image uses Node 20, production dependencies, generated Linux Prisma engines, the unprivileged `node` user, and Tini for signal handling. It excludes local environment files, frontend sources, tests, and host dependencies. The separate migration target includes Prisma's CLI.

Use platform secrets based on `backend/.env.example`: production database/Redis URLs, `NODE_ENV=production`, `COOKIE_SECURE=true`, a random `JWT_SECRET`, public `BACKEND_URL`, and the exact Vercel frontend origin in `FRONTEND_URL`. Set all required tuning variables. Run the migration target as a release task before updating the API and worker.

Equivalent local commands with a separately prepared, uncommitted production environment file:

```sh
docker run --rm --env-file backend.production.env reachbox-migrate
docker run --rm --env-file backend.production.env -p 4000:4000 reachbox-backend
docker run --rm --env-file backend.production.env reachbox-backend node backend/dist/worker.js
```

The default command starts the API; override it with `node backend/dist/worker.js` for the worker. The API respects provider-injected `PORT` and exposes `/health`; the worker has no HTTP port. Allow a termination grace period longer than the configured shutdown timeout (90 seconds by default). Managed Redis needs persistence and no eviction. Container-local `localhost` does not point to the database service.

### Vercel

Set the project's Root Directory to **`Frontend`**, preserving case. This app uses TanStack Start, not a plain static Vite SPA. `Frontend/vercel.json` selects `tanstack-start`; the existing Nitro integration uses its Vercel preset. It preserves server rendering and deep links without an `index.html` catch-all rewrite. See [Vercel's TanStack deployment guide](https://vercel.com/kb/guide/deploy-a-tanstack-start-app-to-vercel).

Use Node 22.x, `bun install --frozen-lockfile`, and `bun run build`. Leave the output directory at its framework default; the verified build emits `.vercel/output` with static assets and a server function. No frontend Dockerfile is needed.

Set `VITE_API_URL` to the backend origin without `/api`. Keep `VITE_USE_MOCKS=true` until authentication/read endpoints exist, then set it to `false`. Never place secrets in `VITE_*` variables. Backend CORS permits the configured frontend origin. Phase 8 must account for cookie hosting: same-site custom subdomains, or Secure/SameSite=None plus CSRF protection for cross-site origins.

## Remaining integrations

Google OAuth (Phase 8) requires client credentials and the exact registered callback URL. Slack (Phase 9) requires client credentials, `incoming-webhook`, and an HTTPS callback such as ngrok for local development. Elasticsearch is healthy locally but its indexing/search implementation is Phase 6. Bull Board is Phase 5. Attachments, email/password login, and star/archive/delete backend actions remain out of scope.

Phase 4 hourly limiting remains outside the current implementation.