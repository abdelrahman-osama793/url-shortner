# Provider comparison (T36 draft)

Prepared 1 November 2026 from providers' official pages (sources at the end). **Nothing has been selected, created or activated.** Free tiers change often, so every figure must be re-checked at signup. Rows marked *unverified* were not stated on the official pages read.

The launch budget is free tiers only (D07). Sleeping and capacity limits are accepted but must be disclosed.

## 1. What Shortlist needs from a host

| Need | Why | Consequence for free tiers |
|---|---|---|
| An **always-on worker** process | Click analytics (D08/D09: visible within ~10 s) and the email outbox | Hosts that sleep, or have no background workers, break analytics and email |
| PostgreSQL 17 (or close), about **15 connections** | API pool 10 + worker 4 + migrations | Tiers with ~20 connections fit; poolers are optional |
| Redis with **Streams, consumer groups and Lua**, persistent, `noeviction` | Sessions, rate limits, click stream | Request-metered tiers run out (below); in-memory-only tiers lose sessions and pending clicks on restart |
| **One browser origin** for the app and the API | `__Host-` cookie with `SameSite=Lax`, plus CSRF and Origin checks | Simplest: the API also serves the Angular build. Or a static host that proxies `/api` and `/r` |

### The always-on worker never lets the backing services idle

Idle load from the current code, with no users at all:

- **Redis.** Each 2-second consumer loop runs XAUTOCLAIM and a blocking XREADGROUP, about 2.6 million commands a month. The 5-second health report runs XRANGE, about 0.5 million more. **The worker alone uses about 3.1 million commands a month.**
- **PostgreSQL.** The outbox is polled every second and the heartbeat is written every 5 seconds, so the database is never idle and scale-to-zero never applies.

These numbers rule out request-metered or compute-hour tiers without code changes.

## 2. Hosting the API and worker

| Option | Free allowance (official page) | Fit | Main risks |
|---|---|---|---|
| **Northflank Developer Sandbox** | "2 services, 2 jobs, 1 addon"; "always on, no sleeping"; "no card needed"; up to $20/month of compute | Good: the API and worker are the 2 services and never sleep | Free CPU/RAM size *unverified*. Their docs say the sandbox "should not be used for production applications" (hobby and demo use). Only 1 addon, so the databases must come from elsewhere |
| **Oracle Cloud Always Free** | Ampere A1: 1,500 OCPU-hours and 9,000 GB-hours a month (≈ 2 OCPU / 12 GB); 200 GB block storage; 10 TB egress | Good capacity: the whole Docker Compose stack fits on one VM | Card required at signup (*unverified* on the page read, widely reported). **Idle reclamation**: an instance is reclaimed if, over 7 days, 95th-percentile CPU, network and memory all stay below 20 %, which a quiet demo will. Backups, TLS, OS updates and monitoring are all self-managed |
| **Render Free** | Free web services, Postgres and Key Value only, **"Background workers … don't qualify"**; spins down after 15 min without traffic (~1 min to wake); 750 instance-hours a month | **Does not fit**: no worker, and the web service sleeps | Free Postgres expires after 30 days; free Key Value is in-memory only and "all of its data is lost" on restart |
| **Koyeb** | No general free compute advertised; free Postgres limited to 5 hours a month | Does not fit | — |

## 3. PostgreSQL

| Option | Free allowance | Fit | Main risks |
|---|---|---|---|
| **Aiven for PostgreSQL (free)** | 1 GB storage, 1 GB RAM, 1 CPU; `max_connections` 20; no card; "use them indefinitely"; automated backups included; one free service per type | Good: ~15 connections fit; the worker's activity keeps it from looking unused | May power off "free services with no continuative activity" (period not stated). **No choice of cloud or region**, so latency to the API host is unknown until created. No connection pooling. Backup retention *unverified*. 1 GB storage limits click retention (below) |
| **Neon Free** | 1 GB per project; **100 CU-hours per project per month**; scale-to-zero after 5 min (cannot be disabled); 6 h restore window | **Does not fit as is**: a never-idle database at the 0.25 CU minimum uses ~183 CU-hours a month, so it runs out around day 16 | Fits only if the worker polled far less often or slept |
| **Render Postgres Free** | 1 GB, **expires after 30 days** | Does not fit | — |

**Storage at 1 GB.** The benchmark database held 1 million links in 302 MB. Raw click events (30 days, D11) take roughly 150–250 bytes each with indexes, so about 2–4 million retained clicks fit beside a small link table. That is plenty for a demo, but the limit should be stated.

## 4. Redis-compatible store

| Option | Free allowance | Fit | Main risks |
|---|---|---|---|
| **Aiven for Valkey (free)** | 1 GB RAM; no card; one free service per type | Good: no command metering stated, and memory fits the 50,000-entry click stream plus sessions | Persistence (AOF/RDB), eviction policy and connection limits *unverified*; must be `noeviction` with persistence or sessions and pending clicks are at risk. Same region and power-off caveats as Aiven PostgreSQL |
| **Upstash Redis Free** | 256 MB, **500K commands a month**, 10 GB bandwidth, 10,000 commands/s, 10,000 connections; EVAL supported | **Does not fit as is**: the idle worker alone needs ~3.1M commands a month (6× the allowance) | Fits only with much longer blocking reads and health intervals, and real traffic would still exceed it |
| **Redis Cloud Free** | 30 MB, single database, best effort | Tight: the click stream cap would have to drop to ~10,000 entries | Persistence, connections and idle rules *unverified* on the page read |
| **Render Key Value Free** | In-memory only, data lost on restart | Does not fit (sessions and pending clicks lost) | — |

## 5. Email sender

| Option | Free allowance | Fit | Main risks |
|---|---|---|---|
| **Resend** | 3,000 emails a month, 100 a day, 3 domains | Good, **with a domain you own** (SPF and DKIM records); SMTP and API both work with the existing outbox | Whether it can send to arbitrary recipients without a verified domain is *unverified*; normally a sandbox sender reaches only the account owner |
| **Brevo** | Free plan with transactional email over SMTP/API (official page did not state the daily cap; widely reported 300 a day) | Possible without a domain using a verified single sender address | A free-mail From address (e.g. Gmail) fails DMARC alignment, so messages land in spam or are rejected. Brevo branding |

**Without a domain, real sign-up verification and password reset are not dependable.** Mailpit stays the development stand-in.

## 6. Human-verification challenge

| Option | Free allowance | Fit | Notes |
|---|---|---|---|
| **Cloudflare Turnstile** | Up to 20 widgets; **unlimited challenges and siteverify calls**; 10 hostnames per widget | Good: the `dev` adapter's slot is ready, and a real adapter is T37 work | Whether the site must use Cloudflare DNS is *unverified*. Hostnames must be preconfigured, so a platform subdomain is acceptable |
| hCaptcha (free) | Not checked in this pass | Alternative | — |

## 7. Country data (analytics)

| Option | Terms | Fit | Notes |
|---|---|---|---|
| **Cloudflare `cf-ipcountry` header** | Free with Cloudflare proxying the site | Best: `TRUSTED_COUNTRY_HEADER` is already supported | Needs the domain on Cloudflare in front of the API, and the header is trustworthy only behind that proxy |
| **DB-IP IP-to-Country Lite** | CC BY 4.0, monthly updates, MMDB 8.1 MB, no account; attribution link required ("IP Geolocation by DB-IP") | Good without a domain | Needs a lookup in the capture path (an MMDB reader dependency, T37). Lower accuracy (index 81 vs 93 commercial) |
| **MaxMind GeoLite2 Country** | Free account and license key; EULA with attribution; old databases must be deleted within 30 days of a new release; 30 downloads a day | Workable | Account and update chores |

Unknown country remains a valid value in every case.

## 8. Putting it together

| Bundle | Hosting | Data | Email | Country | Cost | Disclosed limitations |
|---|---|---|---|---|---|---|
| **A. Managed free services** (recommended) | Northflank sandbox: API (also serving the Angular build) + worker | Aiven PostgreSQL + Aiven Valkey | Resend (needs a domain) or none | Cloudflare header (domain) or DB-IP Lite | $0, plus an optional domain (~$10/year, owner's purchase) | Sandbox is not for production by its terms; small CPU/RAM; data in an Aiven region chosen for us; 1 GB storage |
| **B. One free VM** | Oracle A1 VM running the Compose stack, with Caddy or nginx for TLS | On the VM | As in A | As in A | $0 (card on file) | Idle reclamation; all operations self-managed; single VM, no managed backups |
| C. Render free | — | — | — | — | — | **Not viable**: no worker, sleeping web service, expiring database, volatile Redis |

**Ten-second freshness holds in A and B** because the worker never sleeps. In any sleeping setup it would not, and must not be claimed.

## 9. Launch settings to record (current values; owner may change)

| Setting | Value | Status |
|---|---|---|
| Raw click retention | 30 days | Decided (D11) |
| Aggregate retention | 12 months + lifetime totals | Provisional |
| Guest limits | 5 links/hour per network; challenge after 2 attempts in 10 min | Provisional; open question whether challenge-only rejections should count (T33) |
| Registered limits | 10 links/minute, 100/day per user; 300/day per network | Provisional |
| Sessions | 24 h idle / 7 days absolute; admins 1 h / 12 h; recent sign-in window 10 min | Provisional |
| Click stream cap | 50,000 entries | Provisional; fits a 1 GB Valkey |
| Availability and recovery | Best effort, no SLA; restore from the provider's automated backup (retention to be confirmed); restore time to be measured in T37 | Must be stated publicly |
| Capacity | Free tier far below the laptop benchmark (T35: 1,000 rps); actual free-tier capacity measured after deployment | Must be stated publicly |

## 10. Decisions needed from the owner

1. **Hosting bundle**: A (Northflank + Aiven) or B (Oracle VM).
2. **Domain**: buy one (you make the purchase), or platform subdomain only. This decides email deliverability and the best country source.
3. **Email provider**: Resend (with a domain) or none at launch, with sign-up verification limited.
4. **Guest quota question** from T33 (optional before launch).

Accounts you would need to create (T37, not now): the hosting provider, Aiven (if A), the email provider, Cloudflare (Turnstile, and DNS if a domain is used), and DB-IP needs none.

## Sources (read 1 November 2026)

- Render free tier: <https://render.com/docs/free>
- Neon pricing: <https://neon.com/pricing>
- Upstash Redis pricing and billing: <https://upstash.com/pricing/redis>, <https://upstash.com/docs/redis/overall/billing>, compatibility <https://upstash.com/docs/redis/overall/rediscompatibility>
- Oracle Always Free resources: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
- Aiven: <https://aiven.io/pricing>, <https://aiven.io/free-tier>, <https://aiven.io/docs/platform/concepts/free-plan>
- Koyeb pricing: <https://www.koyeb.com/pricing>
- Northflank: <https://northflank.com/pricing>, <https://northflank.com/docs/v1/application/billing/pricing-on-northflank>
- Redis Cloud pricing: <https://redis.io/pricing/>
- Resend pricing: <https://resend.com/pricing>
- Brevo pricing: <https://www.brevo.com/pricing/>
- Cloudflare Turnstile plans: <https://developers.cloudflare.com/turnstile/plans/>
- MaxMind GeoLite2: <https://dev.maxmind.com/geoip/geolite2-free-geolocation-data>
- DB-IP Lite: <https://db-ip.com/db/download/ip-to-country-lite>
