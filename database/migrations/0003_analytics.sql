-- Click analytics (database-schema.md, "Analytics").
-- No IP addresses, full User-Agent strings, full referrer URLs or visitor IDs are stored.

-- Up Migration

-- Raw events, kept 30 days. event_id is assigned once by the API so retries deduplicate.
CREATE TABLE click_events (
  event_id      uuid        PRIMARY KEY,
  link_id       uuid        NOT NULL REFERENCES links (id),
  occurred_at   timestamptz NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  link_version  integer     NOT NULL CHECK (link_version >= 1),
  country_code  text        NOT NULL CHECK (country_code ~ '^[A-Z]{2}$' OR country_code = 'unknown'),
  device_type   text        NOT NULL CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  referrer_host text        NOT NULL CHECK (char_length(referrer_host) BETWEEN 1 AND 253),
  suspected_bot boolean     NOT NULL DEFAULT false
);

CREATE INDEX click_events_occurred_at_idx ON click_events (occurred_at);
CREATE INDEX click_events_link_occurred_idx ON click_events (link_id, occurred_at);

-- Lifetime totals survive raw and daily retention cleanup.
CREATE TABLE link_totals (
  link_id    uuid        PRIMARY KEY REFERENCES links (id),
  clicks     bigint      NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per link, UTC day, dimension and bucket. Dimensions are separate rollups,
-- not a country × device × referrer cross product.
CREATE TABLE daily_metrics (
  link_id    uuid        NOT NULL REFERENCES links (id),
  day        date        NOT NULL,
  dimension  text        NOT NULL CHECK (dimension IN ('total', 'country', 'device', 'referrer')),
  bucket     text        NOT NULL,
  clicks     bigint      NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (link_id, day, dimension, bucket),

  CONSTRAINT daily_metrics_total_bucket CHECK (dimension <> 'total' OR bucket = 'all')
);

CREATE INDEX daily_metrics_day_idx ON daily_metrics (day);

-- One row per worker role; feeds the pipeline status shown with analytics.
CREATE TABLE worker_state (
  name                    text        PRIMARY KEY,
  heartbeat_at            timestamptz NOT NULL,
  last_batch_committed_at timestamptz,
  oldest_pending_at       timestamptz,
  status                  text        NOT NULL CHECK (status IN ('healthy', 'delayed', 'degraded', 'unknown'))
);

-- Down Migration

DROP TABLE worker_state;
DROP TABLE daily_metrics;
DROP TABLE link_totals;
DROP TABLE click_events;
