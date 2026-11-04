-- Support messages from the Contact page (T44). Abuse goes to abuse_reports instead.

-- Up Migration

CREATE TABLE support_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Signed-in senders are linked to their account (and their messages go with it on deletion).
  user_id     uuid        REFERENCES users (id),
  reply_email text        NOT NULL CHECK (char_length(reply_email) BETWEEN 3 AND 320),
  topic       text        NOT NULL CHECK (topic IN ('account', 'links', 'privacy', 'other')),
  message     text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  closed_by   uuid        REFERENCES users (id),

  CONSTRAINT support_messages_closure_consistent CHECK (
    (status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

CREATE INDEX support_messages_queue_idx ON support_messages (status, created_at, id);
CREATE INDEX support_messages_user_id_idx ON support_messages (user_id);
CREATE INDEX support_messages_closed_at_idx ON support_messages (closed_at) WHERE closed_at IS NOT NULL;

-- Down Migration

DROP TABLE support_messages;
