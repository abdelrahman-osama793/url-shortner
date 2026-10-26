-- Link identity is permanent (technical-design §3, "Link lifecycle"):
--   * code, owner, alias flag and creation time never change after insert;
--   * rows are never deleted, so an allocated code can never be freed and reused.
-- Destination, expiry, owner-disabled and admin-block fields stay editable.
-- Enforced in the database so every code path, including manual SQL, is covered.

-- Up Migration

CREATE FUNCTION reject_link_identity_change() RETURNS trigger
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

CREATE TRIGGER links_identity_immutable
  BEFORE UPDATE OR DELETE ON links
  FOR EACH ROW EXECUTE FUNCTION reject_link_identity_change();

CREATE TRIGGER links_no_truncate
  BEFORE TRUNCATE ON links
  FOR EACH STATEMENT EXECUTE FUNCTION reject_link_identity_change();

-- Down Migration

DROP TRIGGER links_no_truncate ON links;
DROP TRIGGER links_identity_immutable ON links;
DROP FUNCTION reject_link_identity_change();
