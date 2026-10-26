-- Links, code reservations and idempotency (database-schema.md, "Links and allocation").

-- Up Migration

-- COLLATE "C" gives exact, case-sensitive byte comparison: 'Portfolio' <> 'portfolio'.
-- Same character rules as custom aliases; generated 8-character Base62 codes also match.
CREATE DOMAIN short_code AS varchar(32) COLLATE "C"
  CHECK (VALUE ~ '^[A-Za-z0-9_-]{4,32}$');

CREATE TABLE links (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid        REFERENCES users (id),
  code               short_code  NOT NULL UNIQUE,
  is_custom_alias    boolean     NOT NULL DEFAULT false,
  destination_url    text        NOT NULL CHECK (char_length(destination_url) <= 4096),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  owner_disabled_at  timestamptz,
  admin_blocked_at   timestamptz,
  admin_block_reason text,
  version            integer     NOT NULL DEFAULT 1 CHECK (version >= 1),

  -- Guests (owner_id IS NULL) get generated codes that expire exactly seven days after creation.
  -- IS NOT DISTINCT FROM, not '=': with '=' a NULL expires_at yields NULL, which CHECK accepts.
  CONSTRAINT links_guest_rules CHECK (
    owner_id IS NOT NULL
    OR (is_custom_alias = false AND expires_at IS NOT DISTINCT FROM created_at + interval '168 hours')
  ),

  -- A block reason only exists while the link is blocked.
  CONSTRAINT links_block_reason_requires_block CHECK (
    admin_block_reason IS NULL OR admin_blocked_at IS NOT NULL
  )
);

-- Cursor pagination of an owner's links, newest first.
CREATE INDEX links_owner_page_idx ON links (owner_id, created_at DESC, id DESC);

CREATE INDEX links_expires_at_idx ON links (expires_at) WHERE expires_at IS NOT NULL;

-- Codes that may never be allocated (forbidden words) or are retired (tombstones).
CREATE TABLE code_reservations (
  code        short_code  PRIMARY KEY,
  reason      text        NOT NULL CHECK (reason IN ('forbidden', 'tombstone')),
  reserved_at timestamptz NOT NULL DEFAULT now()
);

-- Initial forbidden aliases: route-like and brand-sensitive words.
-- Shorter words (api, r) cannot be codes anyway because codes need 4+ characters.
INSERT INTO code_reservations (code, reason)
VALUES
  ('admin', 'forbidden'),
  ('login', 'forbidden'),
  ('logout', 'forbidden'),
  ('signup', 'forbidden'),
  ('account', 'forbidden'),
  ('health', 'forbidden'),
  ('report', 'forbidden'),
  ('static', 'forbidden'),
  ('assets', 'forbidden'),
  ('support', 'forbidden'),
  ('shortlist', 'forbidden');

-- Stores the original 201 response so a retried creation returns the same result.
CREATE TABLE api_idempotency (
  user_id         uuid        NOT NULL REFERENCES users (id),
  key             text        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  request_hash    bytea       NOT NULL,
  link_id         uuid        NOT NULL REFERENCES links (id),
  response_status smallint    NOT NULL,
  response_body   jsonb       NOT NULL,
  response_etag   text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,

  PRIMARY KEY (user_id, key)
);

CREATE INDEX api_idempotency_expires_at_idx ON api_idempotency (expires_at);
CREATE INDEX api_idempotency_link_id_idx ON api_idempotency (link_id);

-- Down Migration

DROP TABLE api_idempotency;
DROP TABLE code_reservations;
DROP TABLE links;
DROP DOMAIN short_code;
