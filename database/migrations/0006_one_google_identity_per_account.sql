-- An account has at most one Google identity (T16). Linking a second Google account, or
-- swapping the linked one, would silently change who can sign in; the database refuses it for
-- every code path, including manual SQL.

-- Up Migration

CREATE UNIQUE INDEX external_identities_user_provider_key ON external_identities (user_id, provider);

-- Down Migration

DROP INDEX external_identities_user_provider_key;
