# Backend implementation plan

Status: **Approved. Section 2 proposals accepted; Phases 1-5 and split deployment preparation authorized and implemented.**

## 1. Scope and reviewed context

Read all of `SPEC.md`, including Sections 0–11. Reviewed `Frontend/AGENTS.md`, `Frontend/src/lib/api.ts`, `Frontend/src/types.ts`, the email hooks, authenticated route, compose route, recipient parser, package manifest, Vite configuration, and test configuration.

The existing directory is **`Frontend/`**, with a capital F. Preserve that spelling for Linux compatibility; create only the new backend at `backend/`. The frontend uses TanStack Start/Router rather than the spec's React Router, but its HTTP contract is compatible and requires no router replacement. Respect the existing Lovable instruction against rewriting published Git history.

This document records the approved full implementation plan. The current implementation delivers Phases 1-5; Phases 6-10 remain pending. Verification and baseline limitations are recorded in the root README and `docs/phase_4_5_progress.md`. The remaining priority order is Phases 7/8, then Phases 9/6; those implementations have not begun.

## 2. Decisions requiring attention during plan review

### 2.1 Literal BullMQ job ID conflicts with its supported API

The spec requires `Email.jobId = "email:<id>"` and passing that value to BullMQ. BullMQ's official documentation explicitly prohibits colons in custom job IDs: [Job IDs](https://docs.bullmq.io/guide/jobs/job-ids).

**Proposed exception, subject to approval:** retain the exact unique database/business key `email:<uuid>`, and use a deterministic transport key `email-<uuid>` for BullMQ. Centralize the conversion in one helper used by enqueueing, lookup, reconciliation, retry, and diagnostics. The job payload remains only `{ emailId }`. Never generate a fresh key for a retry or reschedule. Do not bypass BullMQ validation or quietly change the requirement. Literal equality between the database key and BullMQ key cannot be promised with the documented API; resolve this before queue implementation.

### 2.2 SMTP cannot provide the absolute exactly-once guarantee as written

Section 0 says never double-send, while Section 9 explicitly acknowledges the crash window during SMTP delivery. Database claims and queue deduplication prevent ordinary duplicate processing, but SMTP acceptance and a PostgreSQL commit cannot form one atomic transaction. Reclaiming an email after SMTP accepted it but before `sent` was committed may send it again. A deterministic SMTP Message-ID helps trace delivery but does not guarantee recipient-side deduplication.

**Proposed interpretation for approval:** implement the specified recovery behavior and document this residual window explicitly, as Section 9 requests. Test and guarantee deduplication of concurrent claims, retries after recorded success, and ordinary restarts; do not label these tests proof of absolute exactly-once delivery. If an absolute guarantee is required, provider-supported idempotent delivery or a changed ambiguous-delivery policy is a prerequisite and departs from the Ethereal/reclaim design.

### 2.3 Test placement already differs from the requested convention

The repository already contains `Frontend/src/test/app-routing.test.tsx` and `Frontend/src/test/setup.ts`. After approval, relocate them into root `tests/frontend/` and update the frontend Vitest configuration and affected imports. Put every new test, fixture, test helper, and test setup file under root `tests/`; no tests inside either application's `src/` directory. This limited frontend maintenance satisfies the instruction for **all** test files.

## 3. Frontend contract to preserve

All fetch requests use `credentials: "include"` and JSON content type. Return JSON on every fetch success, including logout and disconnect; never substitute a `204` response. Errors must be `{ error: string }`, with meaningful HTTP statuses. OAuth initiation and callback endpoints are browser redirects, the intentional exception to JSON responses. Serialize dates as UTC ISO-8601 strings.

| Endpoint | Exact response / behavior |
| --- | --- |
| `GET /api/auth/google` | Browser redirect to Google. |
| `GET /api/auth/google/callback` | Validate OAuth exchange, set session cookie, redirect to `FRONTEND_URL/scheduled`. |
| `GET /api/auth/me` | `{ id, name, email, avatarUrl }`, all strings; `401` without a valid session. Use an empty string if Google supplies no avatar. |
| `POST /api/auth/logout` | `{ ok: true }` and clear the same cookie attributes used at login. |
| `GET /api/emails` | `{ items: Email[], total: number, page: number, limit: number }`; one-based pagination, default limit 20. Accept `status`, `page`, `limit`, `q`. |
| `GET /api/emails/counts` | `{ scheduled: number, sent: number }`. |
| `GET /api/emails/:id` | One `Email`; owner-scoped `404` for missing or inaccessible records. |
| `POST /api/emails/schedule` | `201 { campaignId, total, firstScheduledAt, lastScheduledAt }`; IDs/timestamps are strings, total is a number. |
| `GET /api/senders` | Bare array of `{ id: string, email: string }`; never expose SMTP credentials. |
| `POST /api/senders/ethereal` | One `{ id, email }` for the authenticated owner; required by the spec although the frontend has no creation method yet. |
| `GET /api/slack/connect` | Authenticated browser redirect to Slack. |
| `GET /api/slack/callback` | Validate state and authenticated owner, exchange code, persist connection, redirect to the frontend. |
| `GET /api/slack/status` | `{ connected: false }` or `{ connected: true, teamName: string, channelName: string }`. |
| `DELETE /api/slack/disconnect` | `{ ok: true }`. |

`Email` is exactly `{ id, to, subject, bodyPreview, bodyHtml, status, scheduledAt, sentAt, senderEmail, error, previewUrl }`. Map database `toEmail` to `to`. Generate plain-text, entity-decoded `bodyPreview` of approximately 120 characters. `sentAt`, `error`, and `previewUrl` must be present and nullable. Status is `scheduled | sending | sent | failed`. The frontend's additional `attachments?` field is optional: omit it; attachment delivery remains out of scope, and the compose request does not send attachments.

`status=scheduled` and the scheduled count include `scheduled` and `sending`. `status=sent` and the sent count include `sent` and `failed`. Match mock list ordering: scheduled ascending by `scheduledAt`, sent descending by `scheduledAt`, with ID as a deterministic tie-breaker. Trim `q`; an empty value uses PostgreSQL rather than Elasticsearch.

Accept the existing schedule payload unchanged: `{ senderId, subject, bodyHtml, recipients, startAt, delaySeconds, hourlyLimit }`. Support missing/null `startAt` as now; clamp past dates to now according to the spec even though the UI rejects past dates. Validate finite nonnegative delay and positive integer hourly limit, nonempty subject/body, sender ownership, at most 5,000 input recipients, and at least one valid recipient after trimming, lowercasing, filtering, and deduplication. Preserve first occurrence order. If hourly limit is omitted, use the configured default and store the effective value; the current UI always supplies it.

Frontend integration notes:

- Mocks are enabled unless `VITE_USE_MOCKS` is the literal string `false`. Document `VITE_USE_MOCKS=false` and `VITE_API_URL=http://localhost:4000` (base origin without `/api`). Confirm the actual frontend dev origin and set `FRONTEND_URL` accordingly.
- The mocks artificially spread initial schedules using the hourly limit. Real scheduling must follow the specification's formula; hourly overflow is deferred by the worker. This is a behavior difference, not a response-shape difference.
- CSV/TXT parsing stays client-side; no upload endpoint is needed. Email/password login, starring, archive/delete, and attachments remain outside backend scope.
- CORS must allow the exact frontend origin and credentials, including preflight requests. Never use wildcard credentialed CORS.

## 4. Planned repository structure

Create these paths only after approval. Additional modules may be split within these responsibilities without changing the public contract.

```text
/
  docker-compose.yml
  README.md
  docs/backend_implementation_plan.md
  scripts/load-test.ts
  tests/
    unit/                   # validation, DTOs, scheduling math
    integration/            # real Postgres/Redis, queue and Lua behavior
    contract/               # frontend-compatible API response assertions
    recovery/               # process crashes and persistent service restarts
    frontend/               # relocated existing routing test and setup
    helpers/                # isolated databases/queues, SMTP stub, child processes
    fixtures/
    vitest.backend.config.ts
  backend/
    package.json
    package-lock.json
    tsconfig.json
    .env.example
    prisma/
      schema.prisma
      migrations/
      seed.ts
    src/
      app.ts                # Express assembly, importable without listening
      server.ts             # API startup, Bull Board, shutdown
      worker.ts             # reconciliation, worker startup, shutdown
      config/env.ts         # validated environment and tuning
      db/prisma.ts
      redis/connection.ts
      queue/
        emailQueue.ts       # queue producer, bulk chunks
        jobIdentity.ts      # approved canonical/transport ID mapping
        emailWorker.ts      # email processing state machine
        rateLimiter.ts      # Lua invocation and fixed-window calculations
        lua/hourlyLimit.lua
      services/
        scheduler.ts
        reconciliation.ts
        mailer.ts
        senders.ts
        search.ts
        auth.ts
        slack.ts
      search/elastic.ts     # client and index mappings
      routes/
        auth.ts
        emails.ts
        senders.ts
        slack.ts
        admin.ts
      middleware/
        auth.ts
        errorHandler.ts
        requestValidation.ts
      serializers/email.ts
      validation/emails.ts
      types/                # internal request/session types
  Frontend/                 # preserve existing app and directory case
```

Expose independent `dev:api`, `dev:worker`, production API/worker start commands, build/typecheck, migration, seed, and test commands. Neither API imports nor starts the queue consumer. All test commands resolve files under root `tests/`.

## 5. Implementation phases mapped to SPEC Section 8

### Phase 1 — Docker infrastructure, scaffold, configuration, Prisma, seed

1. Resolve the two design conflicts above before core code. Pin Node-20-compatible dependencies after checking supported versions; keep the prescribed stack.
2. Add PostgreSQL 16, Redis 7 with AOF enabled, and a pinned Elasticsearch 8 image to Compose. Use named volumes, health checks, configurable credentials/ports, single-node Elasticsearch, local security disabled, and the specified 512 MB JVM heap. Bind development-only services locally.
3. Scaffold TypeScript and zod-validated environment handling. Include every Section 3 variable plus `BULL_BOARD_USER`/`BULL_BOARD_PASS`. Keep concurrency, limits, chunk size, request limits, retries/backoff, retention, SMTP timeouts, stale-claim threshold, and rate/debounce TTLs configurable. Example settings retain the specified concurrency 5, minimum delay 2,000 ms, hourly default 200, three attempts, approximately 500-row chunks, and two-minute stale threshold. Validate cookie and OAuth origins consistently.
4. Implement `User`, `Sender`, `Campaign`, `Email`, and `SlackConnection` with the exact specified fields and relationships. Use UUID primary keys, required unique constraints, the status enum, and PostgreSQL `timestamptz` date columns. Add the specified composite indexes and a stale-claim lookup index. Store secrets without exposing them in DTOs/logs.
5. Generate and apply the initial migration. Seed at least two Ethereal accounts for an explicitly selected existing user, using `nodemailer.createTestAccount()`. Document first login then seeding for that user's ID; do not invent Google identities or assign every user the same sender accounts. Make rerunning the seed fill missing accounts rather than create unlimited duplicates.
6. Move the existing frontend tests to root `tests/frontend/`, adjusting Vitest and imports. Establish isolated test databases/queue names.
7. Address setup friction now: inventory Google/Slack credentials, register expected callback URLs, establish the intended ngrok/HTTPS setup, and verify Elasticsearch connectivity. Implement full OAuth flows in their numbered phases; do not expose unauthenticated temporary production endpoints meanwhile.

Acceptance: persistent services start healthy; schema migrates; valid/invalid env is handled clearly; seed provisions owned senders when credentials/network are available; test discovery is restricted to root `tests/`.

### Phase 2 — Scheduling API, BullMQ producer, baseline Ethereal worker

1. Build the authenticated-owner service boundary and request validation. Before Phase 8, exercise it through tests with an injected test identity rather than a public authentication bypass.
2. In one Prisma transaction create the campaign and normalized recipient rows. Use one captured `now`, calculate `max(startAt, now) + i * delaySeconds * 1000`, and persist unique canonical job keys before touching Redis.
3. Enqueue with chunked `queue.addBulk`, approved deterministic queue keys, `{ emailId }` only, and `delay = max(0, scheduledAt - currentTime)`. Configure three attempts, exponential backoff, completed retention age 3,600 seconds, and `removeOnFail: false` through env values.
4. Treat committed PostgreSQL rows as durable scheduling intent. A transaction failure creates no jobs. A Redis failure after commit must not delete accepted rows or invite an automatic duplicate campaign retry: return the normal `201` for a durably accepted campaign, log the dispatch failure, and recover committed scheduled rows through reconciliation on startup and Redis reconnection. State this durability meaning in README; dispatch cannot be on time while Redis is unavailable.
5. Wire an independent worker to load email/campaign/sender from the database and send through bounded-timeout nodemailer transports. Store Ethereal message IDs and preview URLs. Add Elasticsearch indexing in Phase 6.

Acceptance: an owned sender and normalized recipients produce the exact frontend result; initial timings match the spec; 1,000+ recipients enqueue in chunks; a real Ethereal smoke send provides a preview URL. Establish the full safe claim/retry behavior before treating this baseline as production-ready.

### Phase 3 — Atomic claims, retries, status, reconciliation

1. Atomically update only eligible `scheduled` rows to `sending`, incrementing attempts. Enforce persisted `scheduledAt` before sending so a stale queue delay cannot cause an early send. A `sent` or terminal `failed` row is a no-op.
2. Use conditional transitions tied to a monotonic `claimVersion`. Phase 4 separates this from `attempts`, because deferrals restore the attempt counter and would otherwise reuse a fencing value. A worker that lost ownership must not overwrite a newer claim. Bound SMTP execution below the stale threshold and check queue lock ownership when reclaiming stale work; document that this still does not close the SMTP acceptance/commit window.
3. On retryable SMTP failure, restore `scheduled` and store the error before throwing for BullMQ backoff; otherwise the next attempt would skip a `sending` row. Set terminal `failed` only after the configured failure budget is exhausted. Rate-limit deferrals must not be interpreted as SMTP failures; database claim attempts and BullMQ failed attempts are distinct counts.
4. Commit `sent`, `sentAt`, `messageId`, and `previewUrl` before optional side effects. Elasticsearch/Slack failures never turn an accepted send into a retry.
5. Before starting consumption, scan scheduled records in bounded batches and restore missing jobs with their deterministic IDs. Reset genuinely stale `sending` rows with conditional writes. Inspect existing queue states as well as existence: reconcile scheduled DB records behind retained completed/failed jobs through safe state-specific retry/recreation, without removing active work or re-enqueueing sent records.
6. A fresh `sending` claim encountered by a recovered job must defer until the claim can be resolved instead of disappearing as a completed job. Use a one-off BullMQ delayed wake-up when a fresh claim must be revisited. Re-run reconciliation on Redis reconnect with serialized/idempotent execution. No cron, repeatable scheduler, or application timer loop.
7. Handle shutdown by stopping new claims, allowing bounded in-flight work to finish, closing queue connections, and disconnecting data stores. Handle stalled/exhausted queue jobs so rows do not remain permanently `sending`.

Acceptance: two workers cannot claim the same eligible row; replay after recorded success causes no SMTP send; transient failure retries actually run; terminal failures persist; process/Redis restart preserves future work; crash injection covers DB commit before enqueue and reschedule state gaps. Record the ambiguous SMTP crash scenario as a known limitation, not a passing exactly-once assertion.

### Phase 4 — Global pacing and Redis Lua hourly limiter

1. Configure worker concurrency from `WORKER_CONCURRENCY` and BullMQ's queue-wide limiter `{ max: 1, duration: MIN_SEND_DELAY_MS }`. This paces job starts across workers; it is not a strict guarantee of spacing between SMTP completion times.
2. Derive UTC fixed-hour windows consistently, using Redis time to avoid different workers choosing windows from skewed local clocks. Execute atomic Lua `INCR` and initial `EXPIRE` for `rate:{senderId}:{hourWindowStartEpoch}`, with approximately two-hour configurable TTL. Use the campaign's effective limit, falling back to the env default.
3. If `count <= limit`, proceed to SMTP. Otherwise calculate `overflowIndex = count - limit - 1` and `newTime = nextHourWindowStart + overflowIndex * MIN_SEND_DELAY_MS`.
4. Persist the conditional transition back to `scheduled` with the new timestamp, call `job.moveToDelayed(newTime, token)`, then throw `DelayedError`. Do not let a generic error handler turn this control-flow signal into failure or consume retry budget. The official mechanism is documented in [BullMQ process-step jobs](https://docs.bullmq.io/patterns/process-step-jobs).
5. Update the ES projection and trigger debounced Slack notification without allowing either dependency to break deferral. Repair partial DB/Redis transitions using the Phase 3 timing checks and reconciliation.
6. Recheck the limit on every later execution. Repeated overflow can move jobs into subsequent hours; do not drop or terminally fail jobs because they hit the limit.
7. Document fixed-window burst behavior, counter increments for denied attempts, best-effort ordering, and shared sender counters when campaigns have different limits. Preserve the specified per-campaign threshold rather than inventing a new aggregate policy.

Acceptance: with hourly limit 3 and ten emails, three receive first-window admission and seven receive the exact overflow offsets; later windows drain all ten. Concurrent workers share counts, different senders are isolated, expiry is correct, deferrals preserve SMTP retry budget, and the minimum queue pacing applies across worker processes.

### Phase 5 — Bull Board

Mount Bull Board at `/admin/queues` in the API process and protect every dashboard/API subroute with configured basic authentication. Redact credentials in logs. Verify delayed, active, completed, and failed visibility and reject unauthenticated access.

### Phase 6 — Elasticsearch indexing and search

1. Initialize the `emails` index if missing with keywords for IDs/status, text fields for recipient/subject/body, date fields for timestamps, and mappings for all specified fields. Extract plain-text body from HTML.
2. Bulk index committed schedule rows. Update projections for every status transition, including `sending`, retry reset, reschedule, `sent`, and `failed`. Handle per-document bulk failures; log actionable IDs with secrets/body content excluded.
3. For nonblank `q`, use `multi_match` on `toEmail`, `subject`, and `body`, with mandatory owner and grouped-status filters. Hydrate ordered results through owner-scoped Prisma reads and the same DTO serializer, since the specified search document does not contain the complete frontend DTO. Use exact hit totals and deterministic pagination.
4. Non-search list/count/detail/schedule/send operations keep working during an Elasticsearch outage. Search returns a clear `503 { error }` rather than silently pretending there are no matches. Document eventual consistency and provide a manual database-backed reindex command for missed updates, without introducing cron.

Acceptance: recipient, subject, and body searches work; users cannot retrieve each other's records; timestamps/null fields match the frontend; outages never interrupt sends or DB-only reads; reindex repairs missed projections.

### Phase 7 — Read APIs and sender management

Implement owner-filtered list/detail/counts and sender endpoints with the contract above. Register `/counts` before `/:id`. Validate UUIDs, bounded pagination, and status values. Return only public sender fields; provision new Ethereal accounts for the current user. Test grouped statuses, counts, ordering, empty pages, cross-user access, and exact DTO nullability.

### Phase 8 — Google OAuth and session enforcement

1. Implement authorization-code login with expiring, browser-bound OAuth state; verify identity through the chosen official Google flow and upsert by Google identity. Handle email uniqueness conflicts without unsafe account linking.
2. Issue expiring signed JWTs in an httpOnly cookie, with env-controlled Secure and an appropriate SameSite policy. Localhost uses the local development policy; genuinely cross-site HTTPS frontend/API deployments require Secure plus SameSite=None and explicit CSRF protection. Document this for ngrok instead of assuming cookies will work across arbitrary origins.
3. Require auth on `/api/*` except the auth flow endpoints; `/api/auth/me` itself still requires a valid session. Keep CORS preflight ahead of auth. Enforce owner access in services as well as routes. Bind Slack callbacks to the authenticated session and verified state.
4. Implement exact `me` and logout JSON, cookie clearing, error handling, and origin/CSRF checks on mutating routes. Finish real-browser integration with mocks disabled.

Acceptance: Google login reaches `/scheduled`; frontend session queries work with credentials; missing/expired/tampered sessions yield `401`; logout clears access; OAuth state replay and cross-user access fail.

### Phase 9 — Slack OAuth and rate-limit notifications

1. Implement authenticated Slack connect with `incoming-webhook`, signed expiring state carrying user identity and a browser-bound nonce. Reject mismatched/replayed state.
2. Exchange at `oauth.v2.access`, inspect Slack-level errors, and upsert webhook/team/channel for the owner. Implement status and disconnect without returning secrets.
3. On overflow, read the sender owner's current connection. Skip silently when absent. Debounce with `SET slack:notified:{senderId}:{window} NX EX 3600` using configurable expiry.
4. POST the sender, limit, and next eligible time to the webhook with a timeout. Catch/log failures without changing email outcomes. Document that reserving a debounce key before posting can suppress retries of a failed notification in that window.
5. Verify real OAuth through HTTPS/ngrok and one live notification in the intended connected workspace after integration configuration is supplied. Automated tests use a stub webhook. Do not send setup messages merely to probe credentials.

Acceptance: connection/status/disconnect work, reconnect changes the webhook without redeploy, concurrent overflow produces one successful notification per sender/window in the normal case, and Slack outages never block rescheduling.

### Phase 10 — Load exercise, README, end-to-end demonstration

1. Add the spec's operational `scripts/load-test.ts`: schedule 1,000+ synthetic Ethereal recipients with a low limit, use an explicitly authenticated test account, and print initial versus observed rescheduled hour distributions. Distinguish future predictions from sends actually observed. Automated load assertions live only in root `tests/`.
2. Test restart with sends two minutes in the future, multiple workers, partial bulk enqueue, Redis AOF restart, and ES/Slack downtime. Assert real durable state and queue outcomes; do not rely solely on mocks for Lua or claim concurrency.
3. Complete README run commands for Docker, migrations, seed, API, independent worker, frontend env, OAuth/ngrok, Bull Board, Ethereal previews, and tests. Cover architecture, configured 2,000 ms minimum pacing, hourly counters/deferral, recovery, load behavior, assumptions, and the approved job-ID/SMTP limitations.
4. Include the feature checklist, Section 10 five-minute demo sequence, and Section 11 submission checklist. Private repository invitations, publishing, and recording/uploading a video remain separate user actions unless explicitly authorized.

Acceptance: builds/typechecks and applicable automated checks pass; the frontend works against the real API; externally credentialed smoke checks are recorded as passed or explicitly pending, never inferred from stub tests.

## 6. Test strategy and completion checks

| Area | Root-level test location | Evidence |
| --- | --- | --- |
| Validation and DTOs | `tests/unit/`, `tests/contract/` | Normalization, 5,000 cap, timing math, complete response shapes and JSON errors. |
| Idempotency and retries | `tests/integration/` | Real DB conditional claims with two workers, replay of sent records, transient retry, final failure, queue job-ID mapping. |
| Rate limits | `tests/integration/` | Real Redis Lua under concurrent calls, exact window/overflow math, TTL, sender isolation, global pacing, unchanged failure budget on delay. |
| Recovery | `tests/recovery/` | Child-process crashes, missing/terminal queue entries, stale versus live claims, DB/Redis transition gaps, persistent service restart. |
| Search and tenant isolation | `tests/integration/`, `tests/contract/` | Real Elasticsearch filters/search plus unavailable-service behavior and reindex. |
| OAuth and Slack | `tests/integration/`, `tests/contract/` | Stubbed provider exchange, cookie/state protection, debounce and webhook failure isolation; separate credentialed smoke checks. |
| Existing UI regression | `tests/frontend/` | Relocated routing tests continue passing after configuration changes. |

Use dedicated test data stores or isolated namespaces and explicit cleanup limited to test resources. Use controllable clocks/window inputs for boundary tests and real Redis for atomicity; avoid hour-long sleeps. Keep a small real-time pacing/restart check for production behavior. Audit for cron dependencies, repeatable schedules, in-memory rate counters, test files outside `tests/`, exposed secrets, and accidental worker startup in the API process.

## 7. Approval gate

The user approved the plan, the canonical-versus-BullMQ job-ID mapping, the residual SMTP crash window, and root-level test relocation. Phases 1-5 and deployment preparation are authorized. The current resumed task implements and verifies only Phases 4/5; Phases 6-9 are not part of this implementation turn.
