# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Real users come first (owner, 30 Oct 2026). Design decisions optimise for them; portfolio and CV reviewers judge the work as a real product, so it must behave like one rather than present itself as a showcase.

- **Guests:** anyone with a long link who wants a short one now, without an account. They paste a URL on the home page, get a short link that expires after seven days, and copy it. They cannot edit, alias or see analytics for it.
- **Registered users:** people who share links repeatedly (a project, a newsletter, everyday work) and want control: custom aliases, optional expiry, changing the destination later, disabling and re-enabling, and seeing how often and from where each link is clicked. They sign in with email and password or Google.
- **Visitors:** people who open a short link (`/r/{code}`). They should land on the destination at once, or on a plain explanation when the link is missing or no longer active.
- **Reporters:** anyone who finds a harmful short link and reports it, without an account.
- **Administrators:** operators who review abuse reports, block harmful links and suspend abusive accounts, with every action recorded. Admin role is granted only by an operator command, never through the app.

## Product Purpose

A URL shortener that is genuinely usable and could be hardened for real clients: guest and registered short links, public redirects, custom aliases, click analytics, real authentication and abuse moderation. It also exists as the owner's system-design practice and as defensible CV evidence, which is why every claim must be backed by a test, a measurement or a recorded check.

Success for users: a link is created, copied and working in seconds; edits and disables take effect for every request after the change succeeds; analytics are honest about what they know; harmful links can be reported and taken down with an audit trail.

## Positioning

What sets Shortlist apart is truthfulness and control, not novelty:

- Changes are immediate and never stale: no redirect caching, so an edit or disable applies to every request after it succeeds.
- Analytics say what they are: approximate click counts (repeat visits and bots included), never "unique visitors", with visible freshness and pipeline status.
- The interface never pretends: unconnected features, mocks and development-only shortcuts are labelled; nothing reveals whether an account or link exists where that would leak information.
- Owners and administrators are separate powers: owners can never lift an admin block or see internal moderation reasons.

## Operating Context

- Web app (Angular) at desktop and phone widths, light and dark appearance.
- Public routes: home with the guest shortening form, log in / sign up and recovery flows, report a link, short-link redirects (served by the API, not the app).
- Signed-in workspace: your links, per-link analytics, account (sign-in methods, Google linking, password reset by email, log out), and administration for admins.
- Email is part of core flows (verification, password reset). In development all email goes to a local test inbox (Mailpit); no real email provider is configured yet.
- Not deployed. Intended hosting is free tiers only, with their sleeping and capacity limits disclosed.

## Capabilities and Constraints

Confirmed product decisions (url-shortener-handoff/PROJECT_CONTEXT.md, D01–D17), summarised:

- Guests and registered users can create links; redirects are public (D01). Guest links are generated, expire after seven days, and cannot be edited, aliased or tracked (D04).
- Registered links: custom aliases (4–32 ASCII characters, case-sensitive, immutable), optional expiry (no automatic expiry), destination edits, disable/re-enable (D02, D03, D10).
- Sign-in with email/password (verification, reset) and Google, using one session mechanism; Google is linked to an existing account only after proving both identities (D05, D06).
- Analytics: total and daily clicks, country, device type, referring site; target freshness about ten seconds, not an SLA; raw clicks kept 30 days, aggregates after that (D08, D09, D11).
- Edits and disables affect new redirect requests after the successful update; already-opened pages cannot be recalled (D12).
- Guest creation is rate-limited, with a verification challenge when activity looks suspicious (D13).
- Public abuse reporting and an admin area to review reports, block links and suspend accounts (D14).
- Load-test target: one million stored links and 1,000 redirects per second, measured and reported honestly, separate from free-tier capacity (D15).
- Visible Log in and Sign up at every width; a realistic, polished interface rather than a bare dashboard (D16).

Out of scope for the first release: deleting links, claiming guest links, public API keys, unlinking Google, changing the account email, adding a password to a Google-only account, MFA.

Terminology: "short link" / "link", "code" (the part after `/r/`), "alias" (a code the owner chose), "clicks" (never "visitors" or "visits confirmed"), "blocked" (by an admin), "disabled" (by the owner), "owner suspended", "expired".

Undecided: hosting providers; email provider and sender domain; human-verification challenge provider; country lookup source (country shows "Unknown" until then); final aggregate retention, quotas and session lifetimes; admin MFA; recovery objectives.

## Brand Commitments

- **Working name: Shortlist.** Keep using it, but the name and brand details may still change (owner, 30 Oct 2026; PROJECT_CONTEXT.md).
- The revised UI concept (url-shortener-handoff/ui/product-preview.fragment.html, UI_HANDOFF.md) is the agreed visual reference; its exact styling remains adjustable.
- Voice in the existing interface: plain, calm and specific; explains what happened and what to do next; honest about limits ("approximate", "development mock").

## Evidence on Hand

- Working software for tasks T01–T30 (guest links, redirects, auth incl. real Google sign-in and linking, link management, analytics pipeline and views, account page, public reporting, admin APIs), each with recorded validation in the backlog and docs/DECISIONS.md.
- Measured analytics freshness at light load (p95 about 0.6 s, local Docker). This is not evidence for the 1,000 rps target.
- No load-test results, users, customers, testimonials, press, uptime or deployment yet. Do not fabricate any of them.

## Product Principles

1. **Tell the truth.** Never imply something works, is live, is unique or is guaranteed when it is not; label mocks and estimates.
2. **Changes take effect now.** What the owner saves is what the next visitor gets; the UI says exactly when changes apply.
3. **Reveal nothing that is not yours.** Confirmations about accounts, reports and links read the same whatever exists; owners never see moderation internals.
4. **Every power leaves a record.** Administrative actions need a reason, recent confirmation and an audit entry; roles are never granted through the app.
5. **Quick for the guest, in control for the owner.** The fastest path is one field and a Copy button; depth (aliases, analytics, account) is there when signed in.

## Accessibility & Inclusion

From UI_HANDOFF.md (binding):

- Every control works by keyboard, with clear focus states; forms have persistent labels and accessible error messages; status is always expressed in text, not colour alone.
- Approximately 44px touch targets and 16px editable text on phones.
- Layouts work at 320px, 768px and 1280px, including long URLs, validation text and navigation; useful counts and actions remain accessible when desktop columns collapse.
- Both light and dark appearances and reduced motion are reviewed; text, focus and interactive states are checked for contrast on their real backgrounds.
- If copying to the clipboard fails, the short URL stays selectable.
