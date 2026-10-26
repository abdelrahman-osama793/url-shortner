-- Abuse reports and the admin audit trail (database-schema.md, "Moderation and audits").

-- Up Migration

CREATE TABLE abuse_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     uuid        NOT NULL REFERENCES links (id),
  reporter_id uuid        REFERENCES users (id),
  category    text        NOT NULL CHECK (category IN ('phishing', 'malware', 'spam', 'other')),
  details     text        CHECK (char_length(details) <= 2000),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES users (id),

  -- Closed reports record when and by whom; open ones do not.
  CONSTRAINT abuse_reports_resolution_consistent CHECK (
    (status IN ('resolved', 'dismissed')) = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX abuse_reports_queue_idx ON abuse_reports (status, created_at, id);
CREATE INDEX abuse_reports_link_id_idx ON abuse_reports (link_id);

CREATE TABLE admin_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid        NOT NULL REFERENCES users (id),
  action        text        NOT NULL,
  target_type   text        NOT NULL CHECK (target_type IN ('link', 'user', 'report')),
  target_id     uuid        NOT NULL,
  reason        text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  request_id    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_target_idx ON admin_audit (target_type, target_id, created_at);

-- Append-only: enforced in the database so it holds for every role and code path,
-- not just for a restricted application role.
CREATE FUNCTION reject_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER admin_audit_append_only
  BEFORE UPDATE OR DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION reject_audit_change();

CREATE TRIGGER admin_audit_no_truncate
  BEFORE TRUNCATE ON admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();

-- Down Migration

DROP TABLE admin_audit;
DROP FUNCTION reject_audit_change();
DROP TABLE abuse_reports;
