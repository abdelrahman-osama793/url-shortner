-- Accounts and authentication (database-schema.md, "Accounts and authentication").
-- Sessions and Google login attempts live in Redis, not here.

-- Up Migration

CREATE TABLE users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  email_normalized  text        NOT NULL UNIQUE,
  email_verified_at timestamptz,
  role              text        NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'admin')),
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  session_version   integer     NOT NULL DEFAULT 1        CHECK (session_version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Zero rows for Google-only accounts.
CREATE TABLE password_credentials (
  user_id             uuid        PRIMARY KEY REFERENCES users (id),
  password_hash       text        NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

-- A Google subject can belong to only one local user.
CREATE TABLE external_identities (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id),
  provider   text        NOT NULL CHECK (provider IN ('google')),
  subject    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider, subject)
);

CREATE INDEX external_identities_user_id_idx ON external_identities (user_id);

-- Only a SHA-256 hash of each one-time token is stored, never the token itself.
CREATE TABLE auth_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id),
  purpose    text        NOT NULL CHECK (purpose IN ('verification', 'reset')),
  token_hash bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_expires_at_idx ON auth_tokens (expires_at);
CREATE INDEX auth_tokens_user_id_idx ON auth_tokens (user_id);

-- Written in the same transaction as the token; delivered later by the worker.
CREATE TABLE email_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id),
  kind              text        NOT NULL CHECK (kind IN ('verification', 'reset')),
  encrypted_payload bytea       NOT NULL,
  expires_at        timestamptz NOT NULL,
  attempts          integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  sent_at           timestamptz,
  last_error_code   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_outbox_pending_idx ON email_outbox (next_attempt_at) WHERE sent_at IS NULL;
CREATE INDEX email_outbox_user_id_idx ON email_outbox (user_id);

-- Down Migration

DROP TABLE email_outbox;
DROP TABLE auth_tokens;
DROP TABLE external_identities;
DROP TABLE password_credentials;
DROP TABLE users;
