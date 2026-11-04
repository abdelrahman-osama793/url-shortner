# Graph Report - url-shortener  (2026-11-04)

## Corpus Check
- 243 files · ~129,166 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 26 file(s) not represented in the graph (top: .css 19, (none) 5, .example 1)

## Summary
- 1817 nodes · 4191 edges · 116 communities (92 shown, 24 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 179 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5e65e8ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Operator CLI and Mailer
- LinksPage
- CI Workflow
- Angular Workspace Config
- Web Analytics and Links API
- auth.spec.ts
- Server Dependencies
- Web App Config and Session
- AccountPage
- database.js
- click-capture.service.js
- shorten-form.spec.ts
- Auth Controller
- Session Cookie and Admin Tests
- links.service.js
- sessions.test.js
- src/api.js
- Account HTTP Tests
- Web Dev Dependencies
- Accounts
- load.mjs
- Web Admin Types
- @angular/router
- Admin Controller
- pipeline-health.service.js
- Admin Routes and Schemas
- Auth Routes and Schemas
- account-linking.test.js
- Contracts Package
- Session Service
- Web Session Store
- toApiError
- notFoundError
- ref_node_assert
- sessions.test.js
- Angular Runtime Dependencies
- icon.ts
- run.sh
- Admin Page Component
- Compose Services
- Abuse Protection Decisions
- Root Package Config
- protections.test.js
- Click Consumer Internals
- analytics-query.service.js
- Destination URL Rules
- Compose Environment
- protections.test.js
- ref_node_crypto
- Admin moderation template
- Error Handler and Failure Pages
- Report Page
- Decision and Evidence Docs
- Contracts TS Config
- T34 Drill Script
- T35 — Capacity benchmark (evidence)
- click-aggregation.service.js
- guest-links.test.js
- ESLint Config
- constants.js
- Compose Dependencies
- Redirect and Product Principles
- Links page template
- server-latency.mjs
- google.js
- click-pipeline.test.js
- link-editor.ts
- Compose Build
- AppError
- moderation.repository.js
- Redirect resolver (one statement on primary, 302/404/410/503)
- ShortenForm
- Retention Jobs
- Postgres Service
- Architecture Stack
- Provider comparison (T36 draft)
- ref_zod
- redirects.service.js
- Web Admin API
- Web Google Sign-In
- Compose Healthchecks
- Redis Service
- OpenAPI Generator
- Analytics Freshness Script
- Web NPM Scripts
- createGoogleSignInService
- API Service
- Admin and Google Decisions
- Session store and auth guards (session, csrf, user, verified, admin, recentAuth)
- Capacity and Principles
- Root NPM Scripts
- Google Sign-In Check Script
- createClickCaptureService
- seed.mjs
- click-capture.service.test.js
- Test Browser Helper
- Compose Defaults
- Brand Favicon
- google-sign-in.test.js
- CI and Integration Tests
- link-analytics.test.js
- scripts
- logger.js
- createGoogleAttemptsService
- GoogleIdentity

## God Nodes (most connected - your core abstractions)
1. `toApiError()` - 58 edges
2. `@angular/core` - 55 edges
3. `AppError` - 51 edges
4. `startTestApi()` - 46 edges
5. `commonMessage()` - 46 edges
6. `main()` - 42 edges
7. `withTransaction()` - 38 edges
8. `@angular/common` - 33 edges
9. `createLinkService()` - 32 edges
10. `@angular/router` - 32 edges

## Surprising Connections (you probably didn't know these)
- `App` --references--> `App root template (router-outlet)`  [INFERRED]
  apps/web/src/app/app.ts → apps/web/src/app/app.html
- `AccountPage` --references--> `Account page template`  [INFERRED]
  apps/web/src/app/pages/account/account.ts → apps/web/src/app/pages/account/account.html
- `AdminPage` --references--> `Admin moderation template`  [INFERRED]
  apps/web/src/app/pages/admin/admin.ts → apps/web/src/app/pages/admin/admin.html
- `AnalyticsPage` --references--> `Link analytics template`  [INFERRED]
  apps/web/src/app/pages/analytics/analytics.ts → apps/web/src/app/pages/analytics/analytics.html
- `LinksPage` --references--> `Links page template`  [INFERRED]
  apps/web/src/app/pages/links/links.ts → apps/web/src/app/pages/links/links.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Click analytics pipeline (capture -> stream -> worker -> aggregates -> API/UI)** — docs_decisions_click_capture, docs_decisions_analytics_worker, docs_decisions_owner_analytics_api, docs_decisions_retention_and_pipeline_health, docs_decisions_analytics_views [EXTRACTED 1.00]
- **Redis-backed protections that fail closed with 503** — docs_decisions_fixed_window_rate_limiter, docs_decisions_session_store, docs_decisions_challenge_guard, docs_verification_t34_readiness_postgres_only [INFERRED 0.85]
- **Abuse reporting and moderation flow** — docs_decisions_public_abuse_reporting, docs_decisions_admin_moderation_apis, docs_decisions_admin_workspace, docs_decisions_admin_audit_append_only, docs_decisions_redirect_failure_pages [INFERRED 0.85]
- **Report-to-moderation workflow** — apps_web_src_app_pages_report_report_abuse_report_form, apps_web_src_app_pages_admin_admin_report_queue, apps_web_src_app_pages_admin_admin_report_status_change, apps_web_src_app_pages_admin_admin_link_block_unblock, apps_web_src_app_pages_admin_admin_owner_suspension, apps_web_src_app_pages_admin_admin_moderation_audit_history [INFERRED 0.85]

## Communities (116 total, 24 thin omitted)

### Community 0 - "Operator CLI and Mailer"
Cohesion: 0.12
Nodes (31): client, [rawEmail, role], ISOLATION_LEVELS, rollbackAndRelease(), UNAVAILABLE_NETWORK_CODES, withTransaction(), createAccountService(), authenticate() (+23 more)

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
Cohesion: 0.08
Nodes (15): safeNext(), takeFragmentToken(), ready(), render(), settle(), USER, GoogleButton, Login (+7 more)

### Community 6 - "Server Dependencies"
Cohesion: 0.12
Nodes (22): dependencies, argon2@^0.45.1, express@^5.3.0, google-auth-library@^11.3.1, node-pg-migrate@^9.0.0, nodemailer@^10.2.1, pino@^10.4.0, redis@^5.12.1 (+14 more)

### Community 7 - "Web App Config and Session"
Cohesion: 0.12
Nodes (17): DevChallenge, GuestLinks, GooglePurpose, GoogleWindow, sessionExpiryInterceptor(), describeWait(), csrfInterceptor(), SAFE_METHODS (+9 more)

### Community 9 - "database.js"
Cohesion: 0.21
Nodes (8): EXPECTED_TABLES, adminDatabaseUrl(), createMigratedDatabase(), createTestDatabase(), migrate(), MIGRATIONS_DIR, runAdminQuery(), withDatabaseName()

### Community 10 - "click-capture.service.js"
Cohesion: 0.27
Nodes (8): toFields(), DEVICES, countryCode(), NOT_A_COUNTRY, classifyDevice(), DEVICE_TYPES, DIRECT_OR_UNKNOWN, referrerHost()

### Community 11 - "shorten-form.spec.ts"
Cohesion: 0.21
Nodes (5): CsrfToken, answer(), RESULT, showResult(), submit()

### Community 12 - "Auth Controller"
Cohesion: 0.12
Nodes (20): ACCEPTED, createAuthController(), csrf(), login(), logout(), me(), reauthenticate(), recordRecentAuth() (+12 more)

### Community 13 - "Session Cookie and Admin Tests"
Cohesion: 0.08
Nodes (14): SESSION_COOKIE, newAdmin(), POLICIES, report(), newOwner(), POLICIES, newOwner(), POLICIES (+6 more)

### Community 14 - "links.service.js"
Cohesion: 0.20
Nodes (24): validationError(), hashRequest(), runOnce(), isoOrNull(), shortUrlFor(), toGuestLinkResource(), toLinkResource(), aliasUnavailable() (+16 more)

### Community 15 - "sessions.test.js"
Cohesion: 0.13
Nodes (20): createApp(), JSON_BODY_LIMIT, createRedirectsController(), noStore(), requestId(), requestLogger(), createRedirectRouter(), startHealthServer() (+12 more)

### Community 16 - "src/api.js"
Cohesion: 0.09
Nodes (27): close(), listen(), logger, main(), commaSeparatedOrigins, describeIssues(), EnvSchema, loadConfig() (+19 more)

### Community 17 - "Account HTTP Tests"
Cohesion: 0.12
Nodes (21): classify(), createSmtpMailer(), send(), MailDeliveryError, login(), POLICIES, timedLogin(), verificationTokenFor() (+13 more)

### Community 18 - "Web Dev Dependencies"
Cohesion: 0.11
Nodes (24): devDependencies, @angular/build@^22.2.4, @angular/cli@^22.2.4, @angular/compiler-cli@^22.2.0, @angular-eslint/builder@22.6.0, eslint@^10.12.0, @eslint/js@^10.0.1, jsdom@^30.0.0 (+16 more)

### Community 20 - "load.mjs"
Cohesion: 0.08
Nodes (29): agent, code(), cpuTicks(), db, drainStarted, fire(), HOT, LINKS (+21 more)

### Community 21 - "Web Admin Types"
Cohesion: 0.09
Nodes (17): AuditTarget, ReportStatus, Action, ACTION_LABELS, CATEGORY_LABELS, ADMIN, answerAudits(), isAudit() (+9 more)

### Community 22 - "@angular/router"
Cohesion: 0.14
Nodes (12): App, appConfig, routes, App root template (router-outlet), requireAdmin(), requireUser(), AuthLayout, Home (+4 more)

### Community 23 - "Admin Controller"
Cohesion: 0.17
Nodes (11): createAdminController(), inspectLink(), moderateLink(), createLinksController(), createOwnedLink(), getOwnedLink(), updateOwnedLink(), idempotencyKeyOf() (+3 more)

### Community 24 - "pipeline-health.service.js"
Cohesion: 0.22
Nodes (7): ANALYTICS_WORKER_NAME, createPipelineReporter(), reportOnce(), run(), createPipelineStatusReader(), getPipelineStatus(), sharedLossAt()

### Community 25 - "Admin Routes and Schemas"
Cohesion: 0.13
Nodes (17): byUser(), AdminLinkQuerySchema, AdminLinkSchema, AdminReportSchema, AdminUserSchema, AUDIT_TARGET_TYPES, AuditEntrySchema, AuditListResponseSchema (+9 more)

### Community 26 - "Auth Routes and Schemas"
Cohesion: 0.13
Nodes (18): byAccountAndNetwork(), bySignedInAccount(), AcknowledgementSchema, anyPassword, CsrfResponseSchema, email, ForgotPasswordRequestSchema, GoogleSignInRequestSchema (+10 more)

### Community 27 - "account-linking.test.js"
Cohesion: 0.28
Nodes (5): googleProof(), link(), passwordOwner(), POLICIES, signInWithGoogle()

### Community 28 - "Contracts Package"
Cohesion: 0.11
Nodes (19): default, types, dependencies, zod@^4.6.7, devDependencies, typescript@~6.0.3, exports, ./constants (+11 more)

### Community 29 - "Session Service"
Cohesion: 0.35
Nodes (12): createSessionService(), create(), destroy(), get(), lifetimeFor(), markRecentAuth(), redisCall(), remainingMs() (+4 more)

### Community 30 - "Web Session Store"
Cohesion: 0.14
Nodes (5): Session, sections(), setUp(), USER, PublicLayout

### Community 31 - "toApiError"
Cohesion: 0.10
Nodes (7): commonMessage(), toApiError(), WorkspaceLayout, ModerationAction, CheckEmail, ConfirmIdentity, ForgotPassword

### Community 32 - "notFoundError"
Cohesion: 0.21
Nodes (16): notFoundError(), createCursorCodec(), isoOrNull(), toAdminLink(), toAdminReport(), toAuditEntry(), createModerationService(), decodeCursor() (+8 more)

### Community 33 - "ref_node_assert"
Cohesion: 0.18
Nodes (5): VALID_ENV, insertOwnedLink(), insertUser(), query(), NOW

### Community 34 - "sessions.test.js"
Cohesion: 0.10
Nodes (15): CAPTURE_LOSS_KEY, extraServers, guardTestRouter(), limiter(), POLICIES, consumerFor(), reader(), administrator (+7 more)

### Community 35 - "Angular Runtime Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, @angular/common@^22.2.0, @angular/compiler@^22.2.0, @angular/core@^22.2.0, @angular/forms@^22.2.0, @angular/platform-browser@^22.2.0, @angular/router@^22.2.0, @fontsource-variable/manrope@^5.3.0 (+9 more)

### Community 36 - "icon.ts"
Cohesion: 0.15
Nodes (9): PREFERENCES, Theme, ThemePreference, NavItem, Icon, IconName, ICONS, Logo (+1 more)

### Community 37 - "run.sh"
Cohesion: 0.20
Nodes (9): CHALLENGE_PROVIDER, DATABASE_POOL_MAX, DATABASE_URL, LOG_LEVEL, NODE_ENV, PUBLIC_BASE_URL, REDIS_URL, run.sh script (+1 more)

### Community 39 - "Compose Services"
Cohesion: 0.12
Nodes (15): image, ports, restart, command, environment, image, restart, volumes (+7 more)

### Community 40 - "Abuse Protection Decisions"
Cohesion: 0.23
Nodes (11): Challenge guard (requireChallengeWhenSuspicious, dev mock provider), Code allocator (advisory lock + ON CONFLICT, 8-char Base62), Destination URL rules (no private IPs, credentials, localhost), Fixed-window Redis rate limiter (HMAC subjects, fail closed), Guest link creation chain (POST /api/v1/links), Idempotency module runOnce (Idempotency-Key, retry-safe creation), Registered link management (versioned ETags, keyset pagination), withTransaction helper (infra/postgres.js) (+3 more)

### Community 41 - "Root Package Config"
Cohesion: 0.16
Nodes (15): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, eslint-plugin-promise@^7.3.0, globals@^17.13.0, engines, node, eslint (+7 more)

### Community 42 - "protections.test.js"
Cohesion: 0.16
Nodes (22): rateLimit(), toFieldErrors(), validateBody(), validateQuery(), createAdminRouter(), createDevChallengeRouter(), IssueRequestSchema, byNetwork() (+14 more)

### Community 43 - "Click Consumer Internals"
Cohesion: 0.32
Nodes (11): createClickConsumer(), deadLetter(), ensureGroup(), finish(), handle(), persistIndividually(), processOnce(), readNew() (+3 more)

### Community 44 - "analytics-query.service.js"
Cohesion: 0.16
Nodes (13): byClicksThenName(), breakdown(), getLinkAnalytics(), resolveRange(), topReferrers(), zeroFilledDaily(), sumOf(), toDate() (+5 more)

### Community 45 - "Destination URL Rules"
Cohesion: 0.14
Nodes (16): clientNetwork(), ipv6Groups(), networkKey(), ALLOWED_PROTOCOLS, bareHostname(), InvalidDestinationError, isLocalName(), isNonPublicIp() (+8 more)

### Community 46 - "Compose Environment"
Cohesion: 0.34
Nodes (15): environment, CHALLENGE_PROVIDER, DATABASE_URL, EMAIL_OUTBOX_KEY, GOOGLE_CLIENT_ID, LOG_LEVEL, MAIL_FROM, NODE_ENV (+7 more)

### Community 47 - "protections.test.js"
Cohesion: 0.13
Nodes (20): createDevChallengeController(), ChallengeUnavailableError, createChallengeGuard(), check(), createDevChallengeVerifier(), issue(), verify(), sign() (+12 more)

### Community 48 - "ref_node_crypto"
Cohesion: 0.19
Nodes (18): createOutboxSender(), deliver(), processBatch(), run(), formatExpiry(), renderEmail(), TEMPLATES, claimDueMessages() (+10 more)

### Community 49 - "Admin moderation template"
Cohesion: 0.28
Nodes (5): Admin link lookup by code, Report queue by status, Admin moderation template, Effective link status (active/disabled/expired/blocked/ownerSuspended), Abuse report form (link, category, details)

### Community 50 - "Error Handler and Failure Pages"
Cohesion: 0.24
Nodes (13): BODY_PARSER_ERRORS, errorHandler(), notFoundHandler(), sendError(), toAppError(), wantsFailurePage(), codeFromPath(), hasFailurePage() (+5 more)

### Community 52 - "Report Page"
Cohesion: 0.18
Nodes (5): CATEGORIES, Category, extractCode(), ReportPage, Report link template

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
Cohesion: 0.67
Nodes (5): createClickAggregator(), persist(), referrerBuckets(), keyOf(), tally()

### Community 59 - "guest-links.test.js"
Cohesion: 0.12
Nodes (10): MAX_GENERATED_CODE_ATTEMPTS, extraPools, POLICIES, servers, startApi(), createLink(), createOwner(), service() (+2 more)

### Community 60 - "ESLint Config"
Cohesion: 0.18
Nodes (8): angular, { defineConfig }, eslint, tseslint, angular-eslint@22.6.0, typescript-eslint@8.71.0, angular-eslint, typescript-eslint

### Community 61 - "constants.js"
Cohesion: 0.14
Nodes (15): EMAIL_MAX_LENGTH, GOOGLE_PURPOSES, GUEST_LINK_LIFETIME_DAYS, LINKS_PAGE_DEFAULT, LINKS_PAGE_MAX, PASSWORD_MAX_LENGTH, REPORT_CATEGORIES, REPORT_DETAILS_MAX_LENGTH (+7 more)

### Community 62 - "Compose Dependencies"
Cohesion: 0.26
Nodes (12): depends_on, mailpit, migrate, postgres, redis, condition, condition, depends_on (+4 more)

### Community 63 - "Redirect and Product Principles"
Cohesion: 0.22
Nodes (9): Public abuse reporting (POST /api/v1/reports, always 202), Redirect failure pages (byte-identical inactive page, strict CSP), UI foundation (light-dark tokens, layouts, self-hosted fonts/icons), Visual and accessibility matrix (120/120 states), Accessibility & inclusion requirements (UI_HANDOFF.md), PRODUCT.md (Shortlist product definition), Registered users (aliases, expiry, edits, analytics), Reporters (anonymous abuse reports) (+1 more)

### Community 64 - "Links page template"
Cohesion: 0.15
Nodes (9): Log out session, Password change via reset email, Account page template, Daily clicks chart (UTC) with accessible table, Country/device/referrer breakdowns, Link analytics template, Cursor-paginated link list, Enable/disable link toggle (+1 more)

### Community 65 - "server-latency.mjs"
Cohesion: 0.33
Nodes (3): durations, [from, to, ...files], statuses

### Community 67 - "google.js"
Cohesion: 0.20
Nodes (11): createGoogleIdentityService(), loadCertificates(), verify(), GOOGLE_ISSUERS, GoogleCredentialRejectedError, GoogleUnavailableError, base64url(), createTestGoogle() (+3 more)

### Community 68 - "click-pipeline.test.js"
Cohesion: 0.16
Nodes (5): compareIds(), CONSUMER_GROUP, trimProcessed(), DEAD_LETTER_STREAM, pipeline()

### Community 69 - "link-editor.ts"
Cohesion: 0.12
Nodes (11): fromDateInput(), localDate(), pad(), toDateInput(), todayInput(), FieldErrors, LinkEditor, Editor (+3 more)

### Community 70 - "Compose Build"
Cohesion: 0.24
Nodes (11): build, context, dockerfile, build, worker, build, command, image (+3 more)

### Community 71 - "AppError"
Cohesion: 0.10
Nodes (30): AppError, serviceUnavailableError(), clickHeaders(), methodNotAllowed(), redirect(), linkInactiveError(), methodNotAllowedError(), challengeRequired() (+22 more)

### Community 73 - "Redirect resolver (one statement on primary, 302/404/410/503)"
Cohesion: 0.24
Nodes (6): Analytics worker (consumer group, ack after commit, dead letters), Click capture (Redis Stream clicks:v1, bounded, circuit breaker), Effective link status (blocked > ownerSuspended > disabled > expired > active), Redirect resolver (one statement on primary, 302/404/410/503), Outage drills (Redis, PostgreSQL, worker SIGKILL), Visitors (open /r/{code})

### Community 75 - "Retention Jobs"
Cohesion: 0.25
Nodes (4): createRetentionService(), drain(), runOnce(), RAW_EVENT_RETENTION_DAYS

### Community 76 - "Postgres Service"
Cohesion: 0.22
Nodes (9): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, environment, image, ports, restart, volumes (+1 more)

### Community 77 - "Architecture Stack"
Cohesion: 0.27
Nodes (9): Link immutability triggers (migration 0005), Angular 22 SPA (apps/web), @shortlist/contracts (zod 4 schemas + openapi.json), SQL migrations via node-pg-migrate, Express 5 API, Mailpit (local email catcher), PostgreSQL 17 (source of truth), Redis 7.4 (sessions, rate limits, click stream) (+1 more)

### Community 78 - "Provider comparison (T36 draft)"
Cohesion: 0.14
Nodes (13): 10. Decisions needed from the owner, 1. What Shortlist needs from a host, 2. Hosting the API and worker, 3. PostgreSQL, 4. Redis-compatible store, 5. Email sender, 6. Human-verification challenge, 7. Country data (analytics) (+5 more)

### Community 79 - "ref_zod"
Cohesion: 0.14
Nodes (10): AnalyticsQuerySchema, count, isoDate, LinkAnalyticsSchema, PipelineStatusSchema, ErrorCodeSchema, ErrorEnvelopeSchema, FieldErrorSchema (+2 more)

### Community 80 - "redirects.service.js"
Cohesion: 0.26
Nodes (7): createRedirectService(), resolve(), RedirectUnavailableError, generateCode(), effectiveStatus(), ALIAS_PATTERN, GENERATED_CODE_LENGTH

### Community 83 - "Compose Healthchecks"
Cohesion: 0.57
Nodes (8): healthcheck, interval, retries, test, timeout, healthcheck, healthcheck, healthcheck

### Community 84 - "Redis Service"
Cohesion: 0.25
Nodes (8): REDISCLI_AUTH, command, environment, image, ports, restart, volumes, redis

### Community 85 - "OpenAPI Generator"
Cohesion: 0.39
Nodes (7): buildDocument(), COMPONENT_SCHEMAS, jsonBody(), jsonResponse(), main(), OUTPUT, toJsonSchema()

### Community 86 - "Analytics Freshness Script"
Cohesion: 0.21
Nodes (9): call(), CLICKS, main(), percentile(), POLL_MS, SPACING_MS, createMaintenance(), run() (+1 more)

### Community 87 - "Web NPM Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, lint, ng, start, test, watch

### Community 88 - "createGoogleSignInService"
Cohesion: 0.35
Nodes (11): alreadyLinked(), createGoogleSignInService(), createGoogleAccount(), findOrCreateAccount(), link(), reauthenticate(), signIn(), verifyAttempt() (+3 more)

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

### Community 96 - "createClickCaptureService"
Cohesion: 0.36
Nodes (9): createClickCaptureService(), capture(), captureInBackground(), drop(), recordFailure(), recordSharedLoss(), snapshot(), startStatsLog() (+1 more)

### Community 97 - "seed.mjs"
Cohesion: 0.29
Nodes (5): pg@^8.23.1, LINKS, main(), withClient(), pg

### Community 98 - "click-capture.service.test.js"
Cohesion: 0.25
Nodes (4): CLICK_STREAM, fakeRedis(), fake, service()

### Community 100 - "Compose Defaults"
Cohesion: 0.50
Nodes (4): x-server, image, restart, volumes

### Community 101 - "Brand Favicon"
Cohesion: 0.67
Nodes (3): Brand palette (deep teal #183b3e, pale lime #e8efab), Favicon (link-chain mark), Link chain icon motif

### Community 102 - "google-sign-in.test.js"
Cohesion: 0.29
Nodes (5): POLICIES, signInWithGoogle(), startAttempt(), GoogleStartResponseSchema, LoginResponseSchema

### Community 111 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, dev:api, dev:worker, migrate, start:api, start:worker, test

### Community 112 - "logger.js"
Cohesion: 0.47
Nodes (5): createLogger(), REDACT_PATHS, scrubUrlCredentials(), SECRET_KEYS, serializeError()

### Community 114 - "createGoogleAttemptsService"
Cohesion: 0.83
Nodes (4): createGoogleAttemptsService(), consume(), create(), redisCall()

## Knowledge Gaps
- **31 isolated node(s):** `NODE_ENV`, `LOG_LEVEL`, `CHALLENGE_PROVIDER`, `DATABASE_URL`, `REDIS_URL` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 649 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@angular/core` connect `Web App Config and Session` to `Angular Runtime Dependencies`, `icon.ts`, `link-editor.ts`, `auth.spec.ts`, `Web Analytics and Links API`, `shorten-form.spec.ts`, `Web Dev Dependencies`, `Report Page`, `Web Admin Types`, `@angular/router`, `Web Session Store`, `toApiError`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `NODE_ENV`, `LOG_LEVEL`, `CHALLENGE_PROVIDER` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Operator CLI and Mailer` be split into smaller, more focused modules?**
  _Cohesion score 0.11707317073170732 - nodes in this community are weakly interconnected._
- **Why does `toApiError()` connect `toApiError` to `LinksPage`, `icon.ts`, `Web Analytics and Links API`, `Admin Page Component`, `Web App Config and Session`, `AccountPage`, `auth.spec.ts`, `ShortenForm`, `link-editor.ts`, `Web Google Sign-In`, `Report Page`, `Web Admin Types`, `Web Session Store`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `CI Workflow` be split into smaller, more focused modules?**
  _Cohesion score 0.04336734693877551 - nodes in this community are weakly interconnected._
- **Why does `AdminPage` connect `Admin Page Component` to `Admin moderation template`, `Web Admin Types`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Should `Angular Workspace Config` be split into smaller, more focused modules?**
  _Cohesion score 0.04440333024976873 - nodes in this community are weakly interconnected._