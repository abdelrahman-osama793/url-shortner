-- Account deactivation and deletion (T45).
--   * 'deactivated': the owner paused the account; signing in again reactivates it.
--   * 'deleted': the account was deleted but its id is still referenced by moderation records
--     (an administrator's past actions), so only an anonymous row with no personal data remains.
--   * A link may be deleted only once its code is retired (a 'tombstone' reservation), so an
--     allocated code still can never be freed or reused.

-- Up Migration

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'deactivated', 'deleted'));

CREATE OR REPLACE FUNCTION reject_link_identity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'links are never truncated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM code_reservations WHERE code = OLD.code AND reason = 'tombstone') THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'a link can only be deleted after its code is retired (tombstone reservation)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.is_custom_alias IS DISTINCT FROM OLD.is_custom_alias
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'link code, owner, alias flag and creation time are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION reject_link_identity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'links are never deleted; disable or block them instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.is_custom_alias IS DISTINCT FROM OLD.is_custom_alias
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'link code, owner, alias flag and creation time are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'));
