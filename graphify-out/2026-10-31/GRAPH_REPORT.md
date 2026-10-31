# Graph Report - url-shortener  (2026-10-31)

## Corpus Check
- 248 files · ~123,818 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .css 12, (none) 5, .example 1)

## Summary
- 1751 nodes · 4119 edges · 110 communities (89 shown, 21 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 183 edges (avg confidence: 0.86)
- Token cost: 267,253 input · 0 output

## Community Hubs (Navigation)
- Operator CLI and Mailer
- Account and Admin Templates
- CI Workflow
- Angular Workspace Config
- Web Analytics and Links API
- Web Routes and Guards
- Server Dependencies
- Web App Config and Session
- Workspace Layout and Errors
- Reports and DB Constraint Tests
- Click Capture Service
- Web CSRF and API Errors
- Auth Controller
- Session Cookie and Admin Tests
- Idempotency and Link Presenter
- Health Endpoints
- Reports and Challenge Service
- Account HTTP Tests
- Web Dev Dependencies
- Web Accounts Client
- Guest Link Tests
- Web Admin Types
- Layouts, Theme and Home
- Admin Controller
- API Bootstrap and Postgres
- Admin Routes and Schemas
- Auth Routes and Schemas
- Account Linking Tests
- Contracts Package
- Session Service
- Web Session Store
- Auth Guards and AppError
- Express App Assembly
- Links Routes
- Click Stream Consumer
- Angular Runtime Dependencies
- App Root and Theme
- Link Editor and Status
- Admin Page Component
- Compose Services
- Abuse Protection Decisions
- Root Package Config
- Validation and Google Routes
- Click Consumer Internals
- Analytics Query Service
- Destination URL Rules
- Compose Environment
- Moderation Repository
- Analytics and Error Schemas
- Config and Rate Policies
- Error Handler and Failure Pages
- Report Page
- Decision and Evidence Docs
- Contracts TS Config
- T34 Drill Script
- Redirect Routes and Tests
- Click Aggregation
- Moderation Service
- ESLint Config
- Guest Links Web Client
- Compose Dependencies
- Redirect and Product Principles
- Origin Check and Google Errors
- Redirects Controller
- Dev Challenge Controller
- Google Sign-In Service
- Pipeline Health
- Redirect Service
- Compose Build
- Challenge and Rate Middleware
- Links Service Tests
- Analytics Pipeline Docs
- Shared Constants
- Retention Jobs
- Postgres Service
- Architecture Stack
- Rate Limiter Service
- Link Analytics Tests
- Session Tests
- Web Admin API
- Web Google Sign-In
- Compose Healthchecks
- Redis Service
- OpenAPI Generator
- Analytics Freshness Script
- Web NPM Scripts
- Logger
- API Service
- Admin and Google Decisions
- Accounts and Admin Docs
- Capacity and Principles
- Root NPM Scripts
- Google Sign-In Check Script
- Cursor Codec
- Reports Repository
- Test Browser Helper
- Compose Defaults
- Brand Favicon
- Google Identity Wrapper
- CI and Integration Tests

## God Nodes (most connected - your core abstractions)
1. `toApiError()` - 58 edges
2. `@angular/core` - 55 edges
3. `AppError` - 51 edges
4. `startTestApi()` - 46 edges
5. `commonMessage()` - 46 edges
6. `main()` - 42 edges
7. `withTransaction()` - 38 edges
8. `@angular/common` - 33 edges
9. `Icon` - 33 edges
10. `createLinkService()` - 32 edges

## Surprising Connections (you probably didn't know these)
- `App` --references--> `App root template (router-outlet)`  [INFERRED]
  apps/web/src/app/app.ts → apps/web/src/app/app.html
- `AccountPage` --references--> `Account page template`  [INFERRED]
  apps/web/src/app/pages/account/account.ts → apps/web/src/app/pages/account/account.html
- `AdminPage` --references--> `Admin moderation template`  [INFERRED]
  apps/web/src/app/pages/admin/admin.ts → apps/web/src/app/pages/admin/admin.html
- `AnalyticsPage` --references--> `Link analytics template`  [INFERRED]
  apps/web/src/app/pages/analytics/analytics.ts → apps/web/src/app/pages/analytics/analytics.html
- `Effective link status (active/disabled/expired/blocked/ownerSuspended)` --shares_data_with--> `StatusBadge`  [INFERRED]
  apps/web/src/app/pages/links/links.html → apps/web/src/app/shared/ui/status-badge.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Click analytics pipeline (capture -> stream -> worker -> aggregates -> API/UI)** — docs_decisions_click_capture, docs_decisions_analytics_worker, docs_decisions_owner_analytics_api, docs_decisions_retention_and_pipeline_health, docs_decisions_analytics_views [EXTRACTED 1.00]
- **Abuse reporting and moderation flow** — docs_decisions_public_abuse_reporting, docs_decisions_admin_moderation_apis, docs_decisions_admin_workspace, docs_decisions_admin_audit_append_only, docs_decisions_redirect_failure_pages [INFERRED 0.85]
- **Redis-backed protections that fail closed with 503** — docs_decisions_fixed_window_rate_limiter, docs_decisions_session_store, docs_decisions_challenge_guard, docs_verification_t34_readiness_postgres_only [INFERRED 0.85]
- **Report-to-moderation workflow** — apps_web_src_app_pages_report_report_abuse_report_form, apps_web_src_app_pages_admin_admin_report_queue, apps_web_src_app_pages_admin_admin_report_status_change, apps_web_src_app_pages_admin_admin_link_block_unblock, apps_web_src_app_pages_admin_admin_owner_suspension, apps_web_src_app_pages_admin_admin_moderation_audit_history [INFERRED 0.85]
- **Owner link lifecycle controls** — apps_web_src_app_pages_links_links_enable_disable_toggle, apps_web_src_app_pages_links_link_editor_link_expiry_date, apps_web_src_app_pages_links_link_editor_custom_alias_rule, apps_web_src_app_pages_links_links_effective_link_status, apps_web_src_app_pages_links_link_editor_optimistic_concurrency_conflict [INFERRED 0.85]

## Communities (110 total, 21 thin omitted)

### Community 0 - "Operator CLI and Mailer"
Cohesion: 0.06
Nodes (53): client, [rawEmail, role], classify(), createSmtpMailer(), send(), MailDeliveryError, rollbackAndRelease(), withTransaction() (+45 more)

### Community 1 - "Account and Admin Templates"
Cohesion: 0.05
Nodes (21): Admin link lookup by code, Report queue by status, Admin moderation template, ModerationAction, Daily clicks chart (UTC) with accessible table, Country/device/referrer breakdowns, Link analytics template, fromDateInput() (+13 more)

### Community 2 - "CI Workflow"
Cohesion: 0.04
Nodes (48): concurrency, cancel-in-progress, group, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, TEST_DATABASE_URL, TEST_MAILPIT_URL (+40 more)

### Community 3 - "Angular Workspace Config"
Cohesion: 0.04
Nodes (46): build, lint, serve, test, builder, configurations, defaultConfiguration, options (+38 more)

### Community 4 - "Web Analytics and Links API"
Cohesion: 0.07
Nodes (26): Analytics, Links, AnalyticsPage, Breakdown, errorMessage(), LINK, render(), settle() (+18 more)

### Community 5 - "Web Routes and Guards"
Cohesion: 0.08
Nodes (20): routes, requireAdmin(), requireUser(), safeNext(), takeFragmentToken(), AuthLayout, ready(), render() (+12 more)

### Community 6 - "Server Dependencies"
Cohesion: 0.06
Nodes (36): dependencies, argon2@^0.45.1, express@^5.3.0, google-auth-library@^11.3.1, node-pg-migrate@^9.0.0, nodemailer@^10.2.1, pg@^8.23.1, pino@^10.4.0 (+28 more)

### Community 7 - "Web App Config and Session"
Cohesion: 0.14
Nodes (16): GooglePurpose, GoogleWindow, sessionExpiryInterceptor(), csrfInterceptor(), SAFE_METHODS, ConnectStep, render(), settle() (+8 more)

### Community 8 - "Workspace Layout and Errors"
Cohesion: 0.10
Nodes (6): commonMessage(), toApiError(), WorkspaceLayout, AccountPage, CheckEmail, ConfirmIdentity

### Community 9 - "Reports and DB Constraint Tests"
Cohesion: 0.10
Nodes (13): POLICIES, insertOwnedLink(), insertUser(), query(), EXPECTED_TABLES, NOW, adminDatabaseUrl(), createMigratedDatabase() (+5 more)

### Community 10 - "Click Capture Service"
Cohesion: 0.11
Nodes (22): createClickCaptureService(), capture(), captureInBackground(), drop(), recordFailure(), recordSharedLoss(), snapshot(), startStatsLog() (+14 more)

### Community 11 - "Web CSRF and API Errors"
Cohesion: 0.09
Nodes (9): ApiError, CsrfToken, Link expiration date (end of day), ShortenForm, answer(), RESULT, showResult(), submit() (+1 more)

### Community 12 - "Auth Controller"
Cohesion: 0.14
Nodes (20): ACCEPTED, createAuthController(), csrf(), login(), logout(), me(), reauthenticate(), recordRecentAuth() (+12 more)

### Community 13 - "Session Cookie and Admin Tests"
Cohesion: 0.10
Nodes (10): SESSION_COOKIE, passwordOwner(), newAdmin(), POLICIES, report(), newOwner(), POLICIES, newOwner() (+2 more)

### Community 14 - "Idempotency and Link Presenter"
Cohesion: 0.19
Nodes (25): validationError(), hashRequest(), runOnce(), isoOrNull(), shortUrlFor(), toGuestLinkResource(), toLinkResource(), aliasUnavailable() (+17 more)

### Community 15 - "Health Endpoints"
Cohesion: 0.16
Nodes (10): createHealthController(), createHealthRouter(), startHealthServer(), servers, startRedirectServer(), startAuthServer(), ALLOWED_ORIGIN, createCapturingLogger() (+2 more)

### Community 16 - "Reports and Challenge Service"
Cohesion: 0.14
Nodes (16): ACCEPTED, createReportsController(), ChallengeUnavailableError, createChallengeGuard(), check(), createDevChallengeVerifier(), issue(), verify() (+8 more)

### Community 17 - "Account HTTP Tests"
Cohesion: 0.15
Nodes (17): login(), POLICIES, timedLogin(), verificationTokenFor(), createAccount(), POLICIES, requestReset(), resetEmailCount() (+9 more)

### Community 18 - "Web Dev Dependencies"
Cohesion: 0.11
Nodes (24): devDependencies, @angular/build@^22.2.4, @angular/cli@^22.2.4, @angular/compiler-cli@^22.2.0, @angular-eslint/builder@22.6.0, eslint@^10.12.0, @eslint/js@^10.0.1, jsdom@^30.0.0 (+16 more)

### Community 19 - "Web Accounts Client"
Cohesion: 0.12
Nodes (6): Accounts, Log out session, Password change via reset email, Account page template, GoogleButton, PasswordField

### Community 20 - "Guest Link Tests"
Cohesion: 0.12
Nodes (9): extraPools, POLICIES, servers, startApi(), fakeRedis(), fake, createTestRedis(), createUnreachableRedis() (+1 more)

### Community 21 - "Web Admin Types"
Cohesion: 0.13
Nodes (14): AuditTarget, ReportStatus, Action, ACTION_LABELS, CATEGORY_LABELS, ADMIN, answerAudits(), isAudit() (+6 more)

### Community 22 - "Layouts, Theme and Home"
Cohesion: 0.19
Nodes (10): ThemePreference, NavItem, Home, Marketing hero with illustrative example link, Home page template, Icon, IconName, ICONS (+2 more)

### Community 23 - "Admin Controller"
Cohesion: 0.15
Nodes (12): createAdminController(), inspectLink(), moderateLink(), createLinksController(), createOwnedLink(), getOwnedLink(), updateOwnedLink(), idempotencyKeyOf() (+4 more)

### Community 24 - "API Bootstrap and Postgres"
Cohesion: 0.21
Nodes (16): close(), listen(), logger, main(), createPool(), isDatabaseReachable(), ISOLATION_LEVELS, UNAVAILABLE_NETWORK_CODES (+8 more)

### Community 25 - "Admin Routes and Schemas"
Cohesion: 0.13
Nodes (19): validateQuery(), byUser(), createAdminRouter(), AdminLinkQuerySchema, AdminLinkSchema, AdminReportSchema, AdminUserSchema, AUDIT_TARGET_TYPES (+11 more)

### Community 26 - "Auth Routes and Schemas"
Cohesion: 0.13
Nodes (19): byAccountAndNetwork(), bySignedInAccount(), createAuthRouter(), AcknowledgementSchema, anyPassword, CsrfResponseSchema, email, ForgotPasswordRequestSchema (+11 more)

### Community 27 - "Account Linking Tests"
Cohesion: 0.14
Nodes (12): googleProof(), link(), POLICIES, signInWithGoogle(), POLICIES, signInWithGoogle(), startAttempt(), base64url() (+4 more)

### Community 28 - "Contracts Package"
Cohesion: 0.11
Nodes (19): default, types, dependencies, zod@^4.6.7, devDependencies, typescript@~6.0.3, exports, ./constants (+11 more)

### Community 29 - "Session Service"
Cohesion: 0.20
Nodes (16): createSessionService(), create(), destroy(), get(), lifetimeFor(), markRecentAuth(), redisCall(), remainingMs() (+8 more)

### Community 30 - "Web Session Store"
Cohesion: 0.14
Nodes (5): Session, sections(), setUp(), USER, PublicLayout

### Community 31 - "Auth Guards and AppError"
Cohesion: 0.20
Nodes (14): AppError, authenticationRequired(), COOKIE_OPTIONS, createAuthGuards(), admin(), csrf(), recentAuth(), session() (+6 more)

### Community 32 - "Express App Assembly"
Cohesion: 0.21
Nodes (9): createApp(), JSON_BODY_LIMIT, clientNetwork(), notFoundHandler(), noStore(), requestId(), requestLogger(), ipv6Groups() (+1 more)

### Community 33 - "Links Routes"
Cohesion: 0.17
Nodes (15): anonymousOnly(), byNetwork(), byUser(), byUserAndNetwork(), createLinksRouter(), DESTINATION_MAX_LENGTH, GUEST_CREATE_CHALLENGE_ACTION, LINKS_PAGE_DEFAULT (+7 more)

### Community 34 - "Click Stream Consumer"
Cohesion: 0.15
Nodes (6): CLICK_STREAM, CONSUMER_GROUP, DEAD_LETTER_STREAM, createMaintenance(), run(), runOnce()

### Community 35 - "Angular Runtime Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, @angular/common@^22.2.0, @angular/compiler@^22.2.0, @angular/core@^22.2.0, @angular/forms@^22.2.0, @angular/platform-browser@^22.2.0, @angular/router@^22.2.0, @fontsource-variable/manrope@^5.3.0 (+9 more)

### Community 36 - "App Root and Theme"
Cohesion: 0.15
Nodes (7): App, appConfig, App root template (router-outlet), PREFERENCES, Theme, Shortlist brand (short links you control), index.html host page

### Community 37 - "Link Editor and Status"
Cohesion: 0.17
Nodes (5): FieldErrors, Editor, STATUS_LABELS, StatusBadge, IconHost

### Community 39 - "Compose Services"
Cohesion: 0.12
Nodes (15): image, ports, restart, command, environment, image, restart, volumes (+7 more)

### Community 40 - "Abuse Protection Decisions"
Cohesion: 0.17
Nodes (14): Challenge guard (requireChallengeWhenSuspicious, dev mock provider), Code allocator (advisory lock + ON CONFLICT, 8-char Base62), Angular csrfInterceptor (guest-replay bug fixed), Synchronizer CSRF token + Origin check, Destination URL rules (no private IPs, credentials, localhost), Fixed-window Redis rate limiter (HMAC subjects, fail closed), Guest link creation chain (POST /api/v1/links), Idempotency module runOnce (Idempotency-Key, retry-safe creation) (+6 more)

### Community 41 - "Root Package Config"
Cohesion: 0.16
Nodes (15): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, eslint-plugin-promise@^7.3.0, globals@^17.13.0, engines, node, eslint (+7 more)

### Community 42 - "Validation and Google Routes"
Cohesion: 0.22
Nodes (11): toFieldErrors(), validateBody(), createDevChallengeRouter(), IssueRequestSchema, byNetwork(), createGoogleRouter(), byNetwork(), createReportsRouter() (+3 more)

### Community 43 - "Click Consumer Internals"
Cohesion: 0.25
Nodes (14): isDatabaseUnavailable(), compareIds(), createClickConsumer(), deadLetter(), ensureGroup(), finish(), handle(), persistIndividually() (+6 more)

### Community 44 - "Analytics Query Service"
Cohesion: 0.25
Nodes (14): byClicksThenName(), createAnalyticsQueryService(), breakdown(), getLinkAnalytics(), resolveRange(), topReferrers(), zeroFilledDaily(), sumOf() (+6 more)

### Community 45 - "Destination URL Rules"
Cohesion: 0.23
Nodes (12): ALLOWED_PROTOCOLS, bareHostname(), InvalidDestinationError, isLocalName(), isNonPublicIp(), NON_PUBLIC_IPV4, NON_PUBLIC_IPV6, parseUrl() (+4 more)

### Community 46 - "Compose Environment"
Cohesion: 0.34
Nodes (15): environment, CHALLENGE_PROVIDER, DATABASE_URL, EMAIL_OUTBOX_KEY, GOOGLE_CLIENT_ID, LOG_LEVEL, MAIL_FROM, NODE_ENV (+7 more)

### Community 48 - "Analytics and Error Schemas"
Cohesion: 0.14
Nodes (10): AnalyticsQuerySchema, count, isoDate, LinkAnalyticsSchema, PipelineStatusSchema, ErrorCodeSchema, ErrorEnvelopeSchema, FieldErrorSchema (+2 more)

### Community 49 - "Config and Rate Policies"
Cohesion: 0.22
Nodes (10): commaSeparatedOrigins, describeIssues(), EnvSchema, loadConfig(), resolveChallengeProvider(), BucketSchema, DEFAULT_POLICIES, OverridesSchema (+2 more)

### Community 50 - "Error Handler and Failure Pages"
Cohesion: 0.28
Nodes (11): BODY_PARSER_ERRORS, errorHandler(), sendError(), toAppError(), wantsFailurePage(), codeFromPath(), hasFailurePage(), KIND_BY_STATUS (+3 more)

### Community 52 - "Report Page"
Cohesion: 0.18
Nodes (5): CATEGORIES, Category, extractCode(), ReportPage, Report link template

### Community 53 - "Decision and Evidence Docs"
Cohesion: 0.21
Nodes (11): DECISIONS.md (implementation decision record), Provider-dependent work (Google client, email, challenge, GeoIP, hosting), UI foundation (light-dark tokens, layouts, self-hosted fonts/icons), Manual/provider checks (real Google verified; email, challenge, GeoIP not available), T33 browser journeys and visual quality evidence, Visual and accessibility matrix (120/120 states), T34 concurrency, authorisation and failure handling evidence, t34-drills.mjs real-stack drill tool (+3 more)

### Community 54 - "Contracts TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, checkJs, declaration, emitDeclarationOnly, module, outDir, rootDir (+4 more)

### Community 55 - "T34 Drill Script"
Cohesion: 0.24
Nodes (9): instances(), location(), newBrowser(), browser, newOwner(), overload(), [phase, ...args], phases (+1 more)

### Community 56 - "Redirect Routes and Tests"
Cohesion: 0.21
Nodes (6): createRedirectRouter(), extraPools, servers, startRedirectServer(), startSeparateInstance(), express

### Community 57 - "Click Aggregation"
Cohesion: 0.24
Nodes (5): createClickAggregator(), persist(), referrerBuckets(), keyOf(), tally()

### Community 59 - "Moderation Service"
Cohesion: 0.33
Nodes (11): isoOrNull(), toAdminLink(), toAdminReport(), toAuditEntry(), createModerationService(), decodeCursor(), inspectLink(), listAudit() (+3 more)

### Community 60 - "ESLint Config"
Cohesion: 0.18
Nodes (8): angular, { defineConfig }, eslint, tseslint, angular-eslint@22.6.0, typescript-eslint@8.71.0, angular-eslint, typescript-eslint

### Community 61 - "Guest Links Web Client"
Cohesion: 0.26
Nodes (4): DevChallenge, GuestLinks, describeWait(), Step

### Community 62 - "Compose Dependencies"
Cohesion: 0.26
Nodes (12): depends_on, mailpit, migrate, postgres, redis, condition, condition, depends_on (+4 more)

### Community 63 - "Redirect and Product Principles"
Cohesion: 0.20
Nodes (9): Effective link status (blocked > ownerSuspended > disabled > expired > active), Public abuse reporting (POST /api/v1/reports, always 202), Redirect failure pages (byte-identical inactive page, strict CSP), Redirect resolver (one statement on primary, 302/404/410/503), PRODUCT.md (Shortlist product definition), Registered users (aliases, expiry, edits, analytics), Reporters (anonymous abuse reports), Shortlist (working product name) (+1 more)

### Community 64 - "Origin Check and Google Errors"
Cohesion: 0.25
Nodes (5): requireAllowedOrigin(), SAFE_METHODS, GoogleAttemptsUnavailableError, GOOGLE_MAIL_DOMAINS, ERROR_CODES

### Community 65 - "Redirects Controller"
Cohesion: 0.27
Nodes (10): notFoundError(), clickHeaders(), createRedirectsController(), methodNotAllowed(), redirect(), linkInactiveError(), methodNotAllowedError(), moderateLink() (+2 more)

### Community 66 - "Dev Challenge Controller"
Cohesion: 0.27
Nodes (8): createDevChallengeController(), BodySchema, byNetwork(), instances(), issueToken(), POLICIES, post(), startInstance()

### Community 67 - "Google Sign-In Service"
Cohesion: 0.35
Nodes (11): alreadyLinked(), createGoogleSignInService(), createGoogleAccount(), findOrCreateAccount(), link(), reauthenticate(), signIn(), verifyAttempt() (+3 more)

### Community 68 - "Pipeline Health"
Cohesion: 0.24
Nodes (8): createPipelineReporter(), reportOnce(), run(), createPipelineStatusReader(), getPipelineStatus(), sharedLossAt(), consumerFor(), reader()

### Community 69 - "Redirect Service"
Cohesion: 0.29
Nodes (6): createRedirectService(), resolve(), RedirectUnavailableError, generateCode(), effectiveStatus(), GENERATED_CODE_LENGTH

### Community 70 - "Compose Build"
Cohesion: 0.24
Nodes (11): build, context, dockerfile, build, worker, build, command, image (+3 more)

### Community 71 - "Challenge and Rate Middleware"
Cohesion: 0.36
Nodes (6): serviceUnavailableError(), challengeRequired(), requireChallengeWhenSuspicious(), rateLimit(), rateLimitedError(), RateLimitUnavailableError

### Community 72 - "Links Service Tests"
Cohesion: 0.24
Nodes (6): MAX_GENERATED_CODE_ATTEMPTS, createLink(), createOwner(), service(), GuestCreateLinkResponseSchema, LinkSchema

### Community 73 - "Analytics Pipeline Docs"
Cohesion: 0.22
Nodes (8): Analytics views (CSS chart, bounded polling, UTC ranges), Analytics worker (consumer group, ack after commit, dead letters), Click capture (Redis Stream clicks:v1, bounded, circuit breaker), Encrypted email outbox (AES-256-GCM, at-least-once delivery), Owner analytics API (REPEATABLE READ snapshot, string counters), Retention jobs and pipeline health (heartbeat, healthy/delayed/degraded/unknown), Outage drills (Redis, PostgreSQL, worker SIGKILL), API conventions (error envelope, no-store, request IDs, CSRF, rate limits)

### Community 74 - "Shared Constants"
Cohesion: 0.24
Nodes (8): EMAIL_MAX_LENGTH, GOOGLE_PURPOSES, GUEST_LINK_LIFETIME_DAYS, LINKS_PAGE_MAX, PASSWORD_MAX_LENGTH, REPORT_CATEGORIES, REPORT_DETAILS_MAX_LENGTH, ReportRequestSchema

### Community 75 - "Retention Jobs"
Cohesion: 0.25
Nodes (4): createRetentionService(), drain(), runOnce(), RAW_EVENT_RETENTION_DAYS

### Community 76 - "Postgres Service"
Cohesion: 0.22
Nodes (9): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, environment, image, ports, restart, volumes (+1 more)

### Community 77 - "Architecture Stack"
Cohesion: 0.28
Nodes (9): Link immutability triggers (migration 0005), Angular 22 SPA (apps/web), @shortlist/contracts (zod 4 schemas + openapi.json), SQL migrations via node-pg-migrate, Express 5 API, Mailpit (local email catcher), PostgreSQL 17 (source of truth), Redis 7.4 (sessions, rate limits, click stream) (+1 more)

### Community 78 - "Rate Limiter Service"
Cohesion: 0.36
Nodes (6): createRateLimiter(), bucketKey(), consume(), hashSubject(), limiter(), POLICIES

### Community 80 - "Session Tests"
Cohesion: 0.25
Nodes (3): extraServers, guardTestRouter(), MeResponseSchema

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
Cohesion: 0.38
Nodes (6): call(), CLICKS, main(), percentile(), POLL_MS, SPACING_MS

### Community 87 - "Web NPM Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, lint, ng, start, test, watch

### Community 88 - "Logger"
Cohesion: 0.47
Nodes (5): createLogger(), REDACT_PATHS, scrubUrlCredentials(), SECRET_KEYS, serializeError()

### Community 89 - "API Service"
Cohesion: 0.33
Nodes (6): command, image, ports, restart, volumes, api

### Community 90 - "Admin and Google Decisions"
Cohesion: 0.40
Nodes (5): Explicit Google account linking + recent authentication (T16), admin_audit append-only triggers, Admin moderation APIs (atomic audit, advisory lock 1005), Google sign-in (GIS + google-auth-library, nonce-bound attempts), set-role.js operator CLI

### Community 91 - "Accounts and Admin Docs"
Cohesion: 0.33
Nodes (6): Admin workspace (/app/admin, lazy chunk), Argon2id password hashing + no account discovery, One-time tokens (sha256 stored, purpose-bound), Password recovery (reset bumps session_version), Playwright journeys j1-j4 (62/62 checks), Administrators (moderation, operator-granted role)

### Community 92 - "Capacity and Principles"
Cohesion: 0.33
Nodes (4): Measured analytics freshness (p95 ~0.59 s, light load), T35 capacity benchmark (1M links / 1,000 rps), Overload shedding finding (pool 10 sheds at 50-100 concurrent; fix in T35), Owner decisions D01-D17 (PROJECT_CONTEXT.md)

### Community 93 - "Root NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, check, lint, test, verify

### Community 100 - "Compose Defaults"
Cohesion: 0.50
Nodes (4): x-server, image, restart, volumes

### Community 101 - "Brand Favicon"
Cohesion: 0.67
Nodes (3): Brand palette (deep teal #183b3e, pale lime #e8efab), Favicon (link-chain mark), Link chain icon motif

## Knowledge Gaps
- **25 isolated node(s):** `Shortlist (working product name)`, `Registered users (aliases, expiry, edits, analytics)`, `Mailpit (local email catcher)`, `GitHub Actions CI (npm run verify)`, `39-task backlog across milestones A-H` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 600 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@angular/core` connect `Web App Config and Session` to `Angular Runtime Dependencies`, `App Root and Theme`, `Web Routes and Guards`, `Link Editor and Status`, `Web Analytics and Links API`, `Workspace Layout and Errors`, `Web CSRF and API Errors`, `Web Dev Dependencies`, `Web Accounts Client`, `Report Page`, `Web Admin Types`, `Layouts, Theme and Home`, `Guest Links Web Client`, `Web Session Store`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `Shortlist (working product name)`, `Registered users (aliases, expiry, edits, analytics)`, `Mailpit (local email catcher)` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Operator CLI and Mailer` be split into smaller, more focused modules?**
  _Cohesion score 0.05775803144224197 - nodes in this community are weakly interconnected._
- **Why does `toApiError()` connect `Workspace Layout and Errors` to `Account and Admin Templates`, `Web Analytics and Links API`, `Web Routes and Guards`, `Admin Page Component`, `Web App Config and Session`, `Link Editor and Status`, `Web CSRF and API Errors`, `Web Google Sign-In`, `Web Accounts Client`, `Report Page`, `Web Admin Types`, `Layouts, Theme and Home`, `Guest Links Web Client`, `Web Session Store`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `Account and Admin Templates` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `@angular/common` connect `Web App Config and Session` to `Angular Runtime Dependencies`, `App Root and Theme`, `Link Editor and Status`, `Web Routes and Guards`, `Web Analytics and Links API`, `Web CSRF and API Errors`, `Web Dev Dependencies`, `Report Page`, `Web Admin Types`, `Guest Links Web Client`, `Web Session Store`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `CI Workflow` be split into smaller, more focused modules?**
  _Cohesion score 0.04336734693877551 - nodes in this community are weakly interconnected._