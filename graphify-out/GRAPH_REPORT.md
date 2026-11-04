# Graph Report - url-shortener  (2026-11-04)

## Corpus Check
- 273 files · ~144,218 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 32 file(s) not represented in the graph (top: .css 25, (none) 5, .example 1)

## Summary
- 1979 nodes · 4628 edges · 118 communities (97 shown, 21 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 195 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ebfdef98`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- createAccountService
- @angular/router
- CI Workflow
- Angular Workspace Config
- Web Analytics and Links API
- auth.spec.ts
- Server Dependencies
- session.ts
- analytics-query.service.js
- database.js
- click-capture.service.js
- ShortenForm
- Auth Controller
- Session Cookie and Admin Tests
- constants.js
- sessions.test.js
- src/api.js
- accounts.test.js
- Web Dev Dependencies
- load.mjs
- AdminPage
- @angular/core
- Admin Controller
- worker.js
- admin.js
- Auth Routes and Schemas
- report.ts
- Contracts Package
- createSessionService
- logger.js
- toApiError
- google-attempts.service.js
- ref_node_assert
- contact.ts
- Angular Runtime Dependencies
- Icon
- run.sh
- AdminPage
- Compose Services
- Abuse Protection Decisions
- Root Package Config
- createRateLimiter
- Click Consumer Internals
- Destination URL Rules
- Compose Environment
- links.service.test.js
- ref_zod
- support/api.js
- links.js
- createLinkService
- openapi.js
- Decision and Evidence Docs
- Contracts TS Config
- T34 Drill Script
- T35 — Capacity benchmark (evidence)
- click-aggregation.service.js
- Session
- server-latency.mjs
- ESLint Config
- fire
- Compose Dependencies
- Redirect and Product Principles
- sample
- email-delivery.service.js
- google-signin-check.mjs
- admin/admin.ts
- link-analytics.test.js
- link-editor.ts
- Compose Build
- index.js
- moderation.repository.js
- Redirect resolver (one statement on primary, 302/404/410/503)
- session.js
- Retention Jobs
- Postgres Service
- Architecture Stack
- Provider comparison (T36 draft)
- config.js
- account-closure.test.js
- email-delivery.service.test.js
- Web Google Sign-In
- Compose Healthchecks
- Redis Service
- redirects.service.js
- Analytics Freshness Script
- Web NPM Scripts
- support.js
- API Service
- Admin and Google Decisions
- Session store and auth guards (session, csrf, user, verified, admin, recentAuth)
- Capacity and Principles
- Root NPM Scripts
- admin.spec.ts
- support.service.js
- notFoundError
- Theme
- Test Browser Helper
- Compose Defaults
- Brand Favicon
- ref_node_crypto
- CI and Integration Tests
- ui.spec.ts
- layouts.spec.ts
- account-closure.repository.js
- AdminApi
- withTransaction
- ModerationAction
- App

## God Nodes (most connected - your core abstractions)
1. `@angular/core` - 71 edges
2. `toApiError()` - 65 edges
3. `AppError` - 54 edges
4. `startTestApi()` - 54 edges
5. `commonMessage()` - 53 edges
6. `main()` - 48 edges
7. `@angular/router` - 46 edges
8. `withTransaction()` - 42 edges
9. `@angular/common` - 39 edges
10. `Session` - 36 edges

## Surprising Connections (you probably didn't know these)
- `App` --references--> `App root template (router-outlet)`  [INFERRED]
  apps/web/src/app/app.ts → apps/web/src/app/app.html
- `AdminPage` --references--> `Admin moderation template`  [INFERRED]
  apps/web/src/app/pages/admin/admin.ts → apps/web/src/app/pages/admin/admin.html
- `AnalyticsPage` --references--> `Link analytics template`  [INFERRED]
  apps/web/src/app/pages/analytics/analytics.ts → apps/web/src/app/pages/analytics/analytics.html
- `Guest users (7-day generated links)` --conceptually_related_to--> `Guest link creation chain (POST /api/v1/links)`  [INFERRED]
  PRODUCT.md → docs/DECISIONS.md
- `Principle: Reveal nothing that is not yours` --rationale_for--> `Argon2id password hashing + no account discovery`  [INFERRED]
  PRODUCT.md → docs/DECISIONS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Click analytics pipeline (capture -> stream -> worker -> aggregates -> API/UI)** — docs_decisions_click_capture, docs_decisions_analytics_worker, docs_decisions_owner_analytics_api, docs_decisions_retention_and_pipeline_health, docs_decisions_analytics_views [EXTRACTED 1.00]
- **Redis-backed protections that fail closed with 503** — docs_decisions_fixed_window_rate_limiter, docs_decisions_session_store, docs_decisions_challenge_guard, docs_verification_t34_readiness_postgres_only [INFERRED 0.85]
- **Abuse reporting and moderation flow** — docs_decisions_public_abuse_reporting, docs_decisions_admin_moderation_apis, docs_decisions_admin_workspace, docs_decisions_admin_audit_append_only, docs_decisions_redirect_failure_pages [INFERRED 0.85]
- **Report-to-moderation workflow** — apps_web_src_app_pages_report_report_abuse_report_form, apps_web_src_app_pages_admin_admin_report_queue, apps_web_src_app_pages_admin_admin_report_status_change, apps_web_src_app_pages_admin_admin_link_block_unblock, apps_web_src_app_pages_admin_admin_owner_suspension, apps_web_src_app_pages_admin_admin_moderation_audit_history [INFERRED 0.85]

## Communities (118 total, 21 thin omitted)

### Community 0 - "createAccountService"
Cohesion: 0.09
Nodes (37): LINKS, main(), withClient(), client, [rawEmail, role], bySignedInAccount(), createAccountService(), authenticate() (+29 more)

### Community 1 - "@angular/router"
Cohesion: 0.08
Nodes (17): routes, LEGAL_LAST_UPDATED, OPERATOR, AuthLayout, AboutPage, ContactPage, render(), settle() (+9 more)

### Community 2 - "CI Workflow"
Cohesion: 0.04
Nodes (48): concurrency, cancel-in-progress, group, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, TEST_DATABASE_URL, TEST_MAILPIT_URL (+40 more)

### Community 3 - "Angular Workspace Config"
Cohesion: 0.04
Nodes (46): build, lint, serve, test, builder, configurations, defaultConfiguration, options (+38 more)

### Community 4 - "Web Analytics and Links API"
Cohesion: 0.07
Nodes (26): Analytics, Links, AnalyticsPage, Breakdown, errorMessage(), LINK, render(), settle() (+18 more)

### Community 5 - "auth.spec.ts"
Cohesion: 0.10
Nodes (12): requireAdmin(), requireUser(), safeNext(), ready(), render(), settle(), USER, GoogleButton (+4 more)

### Community 6 - "Server Dependencies"
Cohesion: 0.06
Nodes (35): dependencies, argon2@^0.45.1, express@^5.3.0, google-auth-library@^11.3.1, node-pg-migrate@^9.0.0, nodemailer@^10.2.1, pg@^8.23.1, pino@^10.4.0 (+27 more)

### Community 7 - "session.ts"
Cohesion: 0.08
Nodes (18): appConfig, GoogleIdentity, GooglePurpose, GoogleWindow, sessionExpiryInterceptor(), CsrfToken, csrfInterceptor(), SAFE_METHODS (+10 more)

### Community 8 - "analytics-query.service.js"
Cohesion: 0.18
Nodes (14): byClicksThenName(), createAnalyticsQueryService(), breakdown(), getLinkAnalytics(), resolveRange(), topReferrers(), zeroFilledDaily(), sumOf() (+6 more)

### Community 9 - "database.js"
Cohesion: 0.12
Nodes (15): createPool(), ISOLATION_LEVELS, UNAVAILABLE_NETWORK_CODES, extraPools, POLICIES, servers, EXPECTED_TABLES, adminDatabaseUrl() (+7 more)

### Community 10 - "click-capture.service.js"
Cohesion: 0.09
Nodes (23): createClickCaptureService(), capture(), captureInBackground(), drop(), recordFailure(), recordSharedLoss(), snapshot(), startStatsLog() (+15 more)

### Community 12 - "Auth Controller"
Cohesion: 0.15
Nodes (18): ACCEPTED, createAuthController(), csrf(), login(), logout(), me(), reauthenticate(), recordRecentAuth() (+10 more)

### Community 13 - "Session Cookie and Admin Tests"
Cohesion: 0.08
Nodes (14): SESSION_COOKIE, passwordOwner(), newAdmin(), POLICIES, report(), newOwner(), POLICIES, newOwner() (+6 more)

### Community 14 - "constants.js"
Cohesion: 0.24
Nodes (8): GENERATED_CODE_LENGTH, GOOGLE_PURPOSES, GUEST_CREATE_CHALLENGE_ACTION, GUEST_LINK_LIFETIME_DAYS, PASSWORD_MAX_LENGTH, REPORT_CATEGORIES, REPORT_DETAILS_MAX_LENGTH, ReportRequestSchema

### Community 15 - "sessions.test.js"
Cohesion: 0.08
Nodes (24): createApp(), JSON_BODY_LIMIT, createHealthController(), notFoundHandler(), noStore(), requireAllowedOrigin(), requestId(), requestLogger() (+16 more)

### Community 16 - "src/api.js"
Cohesion: 0.09
Nodes (29): close(), listen(), logger, main(), createDevChallengeController(), ACCEPTED, createReportsController(), ACCEPTED (+21 more)

### Community 17 - "accounts.test.js"
Cohesion: 0.16
Nodes (16): login(), POLICIES, timedLogin(), verificationTokenFor(), createAccount(), POLICIES, requestReset(), resetEmailCount() (+8 more)

### Community 18 - "Web Dev Dependencies"
Cohesion: 0.11
Nodes (24): devDependencies, @angular/build@^22.2.4, @angular/cli@^22.2.4, @angular/compiler-cli@^22.2.0, @angular-eslint/builder@22.6.0, eslint@^10.12.0, @eslint/js@^10.0.1, jsdom@^30.0.0 (+16 more)

### Community 20 - "load.mjs"
Cohesion: 0.08
Nodes (19): agent, db, drainStarted, HOT, LINKS, other, PIDS, previous (+11 more)

### Community 22 - "@angular/core"
Cohesion: 0.11
Nodes (12): Consent, ConsentCategory, ConsentChoice, PREFERENCES, ThemePreference, NavItem, CookieConsent, IconName (+4 more)

### Community 23 - "Admin Controller"
Cohesion: 0.18
Nodes (9): createAdminController(), inspectLink(), moderateLink(), createLinksController(), createOwnedLink(), getOwnedLink(), updateOwnedLink(), etagOf() (+1 more)

### Community 24 - "worker.js"
Cohesion: 0.21
Nodes (13): connectInBackground(), installProcessErrorHandlers(), onShutdown(), runMain(), SHUTDOWN_SIGNALS, createPipelineReporter(), reportOnce(), run() (+5 more)

### Community 25 - "admin.js"
Cohesion: 0.13
Nodes (18): byUser(), ACCOUNT_STATUSES, AdminLinkQuerySchema, AdminLinkSchema, AdminReportSchema, AdminUserSchema, AUDIT_TARGET_TYPES, AuditEntrySchema (+10 more)

### Community 26 - "Auth Routes and Schemas"
Cohesion: 0.12
Nodes (20): byAccountAndNetwork(), AcknowledgementSchema, anyPassword, CsrfResponseSchema, DeleteAccountRequestSchema, email, ForgotPasswordRequestSchema, GoogleSignInRequestSchema (+12 more)

### Community 27 - "report.ts"
Cohesion: 0.18
Nodes (5): CATEGORIES, Category, extractCode(), ReportPage, Report link template

### Community 28 - "Contracts Package"
Cohesion: 0.11
Nodes (19): default, types, dependencies, zod@^4.6.7, devDependencies, typescript@~6.0.3, exports, ./constants (+11 more)

### Community 29 - "createSessionService"
Cohesion: 0.35
Nodes (12): createSessionService(), create(), destroy(), get(), lifetimeFor(), markRecentAuth(), redisCall(), remainingMs() (+4 more)

### Community 30 - "logger.js"
Cohesion: 0.47
Nodes (5): createLogger(), REDACT_PATHS, scrubUrlCredentials(), SECRET_KEYS, serializeError()

### Community 31 - "toApiError"
Cohesion: 0.09
Nodes (10): DevChallenge, GuestLinks, ApiError, commonMessage(), describeWait(), toApiError(), WorkspaceLayout, CheckEmail (+2 more)

### Community 32 - "google-attempts.service.js"
Cohesion: 0.36
Nodes (5): createGoogleAttemptsService(), consume(), create(), redisCall(), GoogleAttemptsUnavailableError

### Community 33 - "ref_node_assert"
Cohesion: 0.13
Nodes (8): insertOwnedLink(), insertUser(), query(), NOW, administrator, LIFETIMES, member, store()

### Community 34 - "contact.ts"
Cohesion: 0.13
Nodes (5): SupportApi, SupportStatus, MESSAGE, SupportInbox, TOPIC_LABELS

### Community 35 - "Angular Runtime Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, @angular/common@^22.2.0, @angular/compiler@^22.2.0, @angular/core@^22.2.0, @angular/forms@^22.2.0, @angular/platform-browser@^22.2.0, @angular/router@^22.2.0, @fontsource-variable/manrope@^5.3.0 (+9 more)

### Community 36 - "Icon"
Cohesion: 0.10
Nodes (10): Accounts, takeFragmentToken(), ConnectStep, Action, ConfirmIdentity, PasswordField, State, State (+2 more)

### Community 37 - "run.sh"
Cohesion: 0.20
Nodes (9): CHALLENGE_PROVIDER, DATABASE_POOL_MAX, DATABASE_URL, LOG_LEVEL, NODE_ENV, PUBLIC_BASE_URL, REDIS_URL, run.sh script (+1 more)

### Community 38 - "AdminPage"
Cohesion: 0.06
Nodes (16): AccountPage, Log out session, Password change via reset email, Account page template, Admin link lookup by code, Report queue by status, Admin moderation template, Daily clicks chart (UTC) with accessible table (+8 more)

### Community 39 - "Compose Services"
Cohesion: 0.12
Nodes (15): image, ports, restart, command, environment, image, restart, volumes (+7 more)

### Community 40 - "Abuse Protection Decisions"
Cohesion: 0.23
Nodes (11): Challenge guard (requireChallengeWhenSuspicious, dev mock provider), Code allocator (advisory lock + ON CONFLICT, 8-char Base62), Destination URL rules (no private IPs, credentials, localhost), Fixed-window Redis rate limiter (HMAC subjects, fail closed), Guest link creation chain (POST /api/v1/links), Idempotency module runOnce (Idempotency-Key, retry-safe creation), Registered link management (versioned ETags, keyset pagination), withTransaction helper (infra/postgres.js) (+3 more)

### Community 41 - "Root Package Config"
Cohesion: 0.16
Nodes (15): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, eslint-plugin-promise@^7.3.0, globals@^17.13.0, engines, node, eslint (+7 more)

### Community 42 - "createRateLimiter"
Cohesion: 0.36
Nodes (6): createRateLimiter(), bucketKey(), consume(), hashSubject(), RateLimitUnavailableError, limiter()

### Community 43 - "Click Consumer Internals"
Cohesion: 0.13
Nodes (26): BODY_PARSER_ERRORS, errorHandler(), sendError(), toAppError(), wantsFailurePage(), codeFromPath(), hasFailurePage(), KIND_BY_STATUS (+18 more)

### Community 45 - "Destination URL Rules"
Cohesion: 0.14
Nodes (16): clientNetwork(), ipv6Groups(), networkKey(), ALLOWED_PROTOCOLS, bareHostname(), InvalidDestinationError, isLocalName(), isNonPublicIp() (+8 more)

### Community 46 - "Compose Environment"
Cohesion: 0.34
Nodes (15): environment, CHALLENGE_PROVIDER, DATABASE_URL, EMAIL_OUTBOX_KEY, GOOGLE_CLIENT_ID, LOG_LEVEL, MAIL_FROM, NODE_ENV (+7 more)

### Community 47 - "links.service.test.js"
Cohesion: 0.28
Nodes (5): MAX_GENERATED_CODE_ATTEMPTS, createLink(), createOwner(), service(), GuestCreateLinkResponseSchema

### Community 48 - "ref_zod"
Cohesion: 0.14
Nodes (10): AnalyticsQuerySchema, count, isoDate, LinkAnalyticsSchema, PipelineStatusSchema, ErrorCodeSchema, ErrorEnvelopeSchema, FieldErrorSchema (+2 more)

### Community 49 - "support/api.js"
Cohesion: 0.13
Nodes (30): requireChallengeWhenSuspicious(), rateLimit(), rateLimitedError(), toFieldErrors(), validateBody(), validateQuery(), byUser(), createAccountRouter() (+22 more)

### Community 50 - "links.js"
Cohesion: 0.20
Nodes (9): LINKS_PAGE_DEFAULT, LINKS_PAGE_MAX, destinationUrl, EffectiveStatusSchema, GuestCreateLinkRequestSchema, LinkListResponseSchema, ListLinksQuerySchema, RegisteredCreateLinkRequestSchema (+1 more)

### Community 51 - "createLinkService"
Cohesion: 0.19
Nodes (23): hashRequest(), runOnce(), isoOrNull(), toGuestLinkResource(), toLinkResource(), aliasUnavailable(), codeSpaceExhausted(), createLinkService() (+15 more)

### Community 52 - "openapi.js"
Cohesion: 0.33
Nodes (7): buildDocument(), COMPONENT_SCHEMAS, jsonBody(), jsonResponse(), main(), OUTPUT, toJsonSchema()

### Community 53 - "Decision and Evidence Docs"
Cohesion: 0.33
Nodes (8): DECISIONS.md (implementation decision record), Provider-dependent work (Google client, email, challenge, GeoIP, hosting), Manual/provider checks (real Google verified; email, challenge, GeoIP not available), T33 browser journeys and visual quality evidence, T34 concurrency, authorisation and failure handling evidence, t34-drills.mjs real-stack drill tool, 39-task backlog across milestones A-H, README.md (Shortlist URL shortener)

### Community 54 - "Contracts TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, checkJs, declaration, emitDeclarationOnly, module, outDir, rootDir (+4 more)

### Community 55 - "T34 Drill Script"
Cohesion: 0.24
Nodes (9): instances(), location(), newBrowser(), browser, newOwner(), overload(), [phase, ...args], phases (+1 more)

### Community 56 - "T35 — Capacity benchmark (evidence)"
Cohesion: 0.22
Nodes (8): 1. Setup, 2. Results at the 1,000 rps target, 3. Where it breaks (30-second steps, broad), 4. The T34 finding, revisited, 5. Findings, 6. Reproducing, Resources (average over the measured window), T35 — Capacity benchmark (evidence)

### Community 57 - "click-aggregation.service.js"
Cohesion: 0.22
Nodes (6): createClickAggregator(), persist(), referrerBuckets(), keyOf(), tally(), pipeline()

### Community 58 - "Session"
Cohesion: 0.16
Nodes (4): Session, CloseAccount, render(), settle()

### Community 59 - "server-latency.mjs"
Cohesion: 0.33
Nodes (3): durations, [from, to, ...files], statuses

### Community 60 - "ESLint Config"
Cohesion: 0.18
Nodes (8): angular, { defineConfig }, eslint, tseslint, angular-eslint@22.6.0, typescript-eslint@8.71.0, angular-eslint, typescript-eslint

### Community 61 - "fire"
Cohesion: 0.40
Nodes (5): code(), fire(), owner(), pick(), send()

### Community 62 - "Compose Dependencies"
Cohesion: 0.26
Nodes (12): depends_on, mailpit, migrate, postgres, redis, condition, condition, depends_on (+4 more)

### Community 63 - "Redirect and Product Principles"
Cohesion: 0.22
Nodes (9): Public abuse reporting (POST /api/v1/reports, always 202), Redirect failure pages (byte-identical inactive page, strict CSP), UI foundation (light-dark tokens, layouts, self-hosted fonts/icons), Visual and accessibility matrix (120/120 states), Accessibility & inclusion requirements (UI_HANDOFF.md), PRODUCT.md (Shortlist product definition), Registered users (aliases, expiry, edits, analytics), Reporters (anonymous abuse reports) (+1 more)

### Community 64 - "sample"
Cohesion: 0.40
Nodes (5): cpuTicks(), pipeline(), run, sample(), sampler

### Community 65 - "email-delivery.service.js"
Cohesion: 0.20
Nodes (18): createOutboxSender(), deliver(), processBatch(), run(), formatExpiry(), renderEmail(), TEMPLATES, claimDueMessages() (+10 more)

### Community 67 - "admin/admin.ts"
Cohesion: 0.17
Nodes (6): AuditTarget, ReportStatus, Action, ACTION_LABELS, CATEGORY_LABELS, STATUSES

### Community 68 - "link-analytics.test.js"
Cohesion: 0.09
Nodes (10): createRedisClient(), CLICK_STREAM, CONSUMER_GROUP, DEAD_LETTER_STREAM, NOW, POLICIES, POLICIES, createTestRedis() (+2 more)

### Community 69 - "link-editor.ts"
Cohesion: 0.12
Nodes (11): fromDateInput(), localDate(), pad(), toDateInput(), todayInput(), FieldErrors, LinkEditor, Editor (+3 more)

### Community 70 - "Compose Build"
Cohesion: 0.24
Nodes (11): build, context, dockerfile, build, worker, build, command, image (+3 more)

### Community 71 - "index.js"
Cohesion: 0.14
Nodes (20): AppError, serviceUnavailableError(), idempotencyKeyOf(), clickHeaders(), createRedirectsController(), methodNotAllowed(), redirect(), linkInactiveError() (+12 more)

### Community 73 - "Redirect resolver (one statement on primary, 302/404/410/503)"
Cohesion: 0.24
Nodes (6): Analytics worker (consumer group, ack after commit, dead letters), Click capture (Redis Stream clicks:v1, bounded, circuit breaker), Effective link status (blocked > ownerSuspended > disabled > expired > active), Redirect resolver (one statement on primary, 302/404/410/503), Outage drills (Redis, PostgreSQL, worker SIGKILL), Visitors (open /r/{code})

### Community 74 - "session.js"
Cohesion: 0.15
Nodes (19): createAccountController(), deactivate(), deleteAccount(), endSession(), authenticationRequired(), clearSessionCookie(), COOKIE_OPTIONS, createAuthGuards() (+11 more)

### Community 75 - "Retention Jobs"
Cohesion: 0.20
Nodes (5): createRetentionService(), drain(), runOnce(), RAW_EVENT_RETENTION_DAYS, SUPPORT_RETENTION_DAYS

### Community 76 - "Postgres Service"
Cohesion: 0.22
Nodes (9): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, environment, image, ports, restart, volumes (+1 more)

### Community 77 - "Architecture Stack"
Cohesion: 0.27
Nodes (9): Link immutability triggers (migration 0005), Angular 22 SPA (apps/web), @shortlist/contracts (zod 4 schemas + openapi.json), SQL migrations via node-pg-migrate, Express 5 API, Mailpit (local email catcher), PostgreSQL 17 (source of truth), Redis 7.4 (sessions, rate limits, click stream) (+1 more)

### Community 78 - "Provider comparison (T36 draft)"
Cohesion: 0.14
Nodes (13): 10. Decisions needed from the owner, 1. What Shortlist needs from a host, 2. Hosting the API and worker, 3. PostgreSQL, 4. Redis-compatible store, 5. Email sender, 6. Human-verification challenge, 7. Country data (analytics) (+5 more)

### Community 79 - "config.js"
Cohesion: 0.21
Nodes (11): commaSeparatedOrigins, describeIssues(), EnvSchema, loadConfig(), resolveChallengeProvider(), BucketSchema, DEFAULT_POLICIES, OverridesSchema (+3 more)

### Community 80 - "account-closure.test.js"
Cohesion: 0.20
Nodes (3): logIn(), passwordOwner(), POLICIES

### Community 81 - "email-delivery.service.test.js"
Cohesion: 0.23
Nodes (8): classify(), createSmtpMailer(), send(), MailDeliveryError, key, sender(), withDatabase(), testSmtpUrl()

### Community 83 - "Compose Healthchecks"
Cohesion: 0.57
Nodes (8): healthcheck, interval, retries, test, timeout, healthcheck, healthcheck, healthcheck

### Community 84 - "Redis Service"
Cohesion: 0.25
Nodes (8): REDISCLI_AUTH, command, environment, image, ports, restart, volumes, redis

### Community 85 - "redirects.service.js"
Cohesion: 0.31
Nodes (4): resolve(), RedirectUnavailableError, generateCode(), effectiveStatus()

### Community 86 - "Analytics Freshness Script"
Cohesion: 0.38
Nodes (6): call(), CLICKS, main(), percentile(), POLL_MS, SPACING_MS

### Community 87 - "Web NPM Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, lint, ng, start, test, watch

### Community 88 - "support.js"
Cohesion: 0.18
Nodes (10): EMAIL_MAX_LENGTH, SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_TOPICS, AdminSupportMessageSchema, SUPPORT_MESSAGE_STATUSES, SupportMessageRequestSchema, SupportQueueQuerySchema, SupportQueueResponseSchema (+2 more)

### Community 89 - "API Service"
Cohesion: 0.33
Nodes (6): command, image, ports, restart, volumes, api

### Community 90 - "Admin and Google Decisions"
Cohesion: 0.25
Nodes (8): Explicit Google account linking + recent authentication (T16), admin_audit append-only triggers, Admin moderation APIs (atomic audit, advisory lock 1005), Admin workspace (/app/admin, lazy chunk), Google sign-in (GIS + google-auth-library, nonce-bound attempts), Playwright journeys j1-j4 (62/62 checks), Administrators (moderation, operator-granted role), set-role.js operator CLI

### Community 91 - "Session store and auth guards (session, csrf, user, verified, admin, recentAuth)"
Cohesion: 0.25
Nodes (8): Argon2id password hashing + no account discovery, Angular csrfInterceptor (guest-replay bug fixed), Synchronizer CSRF token + Origin check, Encrypted email outbox (AES-256-GCM, at-least-once delivery), One-time tokens (sha256 stored, purpose-bound), Password recovery (reset bumps session_version), Session store and auth guards (session, csrf, user, verified, admin, recentAuth), API conventions (error envelope, no-store, request IDs, CSRF, rate limits)

### Community 92 - "Capacity and Principles"
Cohesion: 0.22
Nodes (7): Measured analytics freshness (p95 ~0.59 s, light load), Analytics views (CSS chart, bounded polling, UTC ranges), Owner analytics API (REPEATABLE READ snapshot, string counters), Retention jobs and pipeline health (heartbeat, healthy/delayed/degraded/unknown), T35 capacity benchmark (1M links / 1,000 rps), Overload shedding finding (pool 10 sheds at 50-100 concurrent; fix in T35), Owner decisions D01-D17 (PROJECT_CONTEXT.md)

### Community 93 - "Root NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, check, lint, test, verify

### Community 95 - "admin.spec.ts"
Cohesion: 0.33
Nodes (8): ADMIN, answerAudits(), isAudit(), page(), render(), REPORT, settle(), setUp()

### Community 96 - "support.service.js"
Cohesion: 0.19
Nodes (8): validationError(), createCursorCodec(), createSupportService(), list(), setStatus(), submit(), isoOrNull(), toAdminMessage()

### Community 97 - "notFoundError"
Cohesion: 0.26
Nodes (16): notFoundError(), shortUrlFor(), isoOrNull(), toAdminLink(), toAdminReport(), toAuditEntry(), createModerationService(), decodeCursor() (+8 more)

### Community 100 - "Compose Defaults"
Cohesion: 0.50
Nodes (4): x-server, image, restart, volumes

### Community 101 - "Brand Favicon"
Cohesion: 0.67
Nodes (3): Brand palette (deep teal #183b3e, pale lime #e8efab), Favicon (link-chain mark), Link chain icon motif

### Community 102 - "ref_node_crypto"
Cohesion: 0.13
Nodes (13): googleProof(), link(), POLICIES, signInWithGoogle(), POLICIES, signInWithGoogle(), startAttempt(), base64url() (+5 more)

### Community 110 - "ui.spec.ts"
Cohesion: 0.28
Nodes (4): status(), STATUS_LABELS, StatusBadge, IconHost

### Community 111 - "layouts.spec.ts"
Cohesion: 0.25
Nodes (4): sections(), setUp(), USER, PublicLayout

### Community 114 - "withTransaction"
Cohesion: 0.47
Nodes (6): rollbackAndRelease(), withTransaction(), createAccountClosureService(), deactivate(), deleteAccount(), reserveCode()

### Community 117 - "App"
Cohesion: 0.40
Nodes (4): App, App root template (router-outlet), Shortlist brand (short links you control), index.html host page

## Knowledge Gaps
- **31 isolated node(s):** `NODE_ENV`, `LOG_LEVEL`, `CHALLENGE_PROVIDER`, `DATABASE_URL`, `REDIS_URL` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 717 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@angular/core` connect `@angular/core` to `@angular/router`, `contact.ts`, `admin/admin.ts`, `Angular Runtime Dependencies`, `link-editor.ts`, `Icon`, `session.ts`, `auth.spec.ts`, `Web Analytics and Links API`, `ui.spec.ts`, `layouts.spec.ts`, `Web Dev Dependencies`, `Session`, `report.ts`, `admin.spec.ts`, `toApiError`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `NODE_ENV`, `LOG_LEVEL`, `CHALLENGE_PROVIDER` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `createAccountService` be split into smaller, more focused modules?**
  _Cohesion score 0.0859465737514518 - nodes in this community are weakly interconnected._
- **Why does `toApiError()` connect `toApiError` to `@angular/router`, `contact.ts`, `admin/admin.ts`, `Icon`, `Web Analytics and Links API`, `AdminPage`, `session.ts`, `auth.spec.ts`, `link-editor.ts`, `ShortenForm`, `Web Google Sign-In`, `ModerationAction`, `AdminPage`, `@angular/core`, `Session`, `report.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `@angular/router` be split into smaller, more focused modules?**
  _Cohesion score 0.08305647840531562 - nodes in this community are weakly interconnected._
- **Why does `@angular/common` connect `session.ts` to `@angular/router`, `contact.ts`, `admin/admin.ts`, `Angular Runtime Dependencies`, `link-editor.ts`, `Icon`, `Web Analytics and Links API`, `auth.spec.ts`, `layouts.spec.ts`, `Web Dev Dependencies`, `@angular/core`, `Session`, `report.ts`, `admin.spec.ts`, `toApiError`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `CI Workflow` be split into smaller, more focused modules?**
  _Cohesion score 0.04336734693877551 - nodes in this community are weakly interconnected._