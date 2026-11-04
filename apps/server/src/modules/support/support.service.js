import { notFoundError, validationError } from '../../errors.js';
import { createCursorCodec } from '../links/rules/cursor.js';

import * as repository from './support.repository.js';

// Support messages from the Contact page (T44). Anyone can write; only admins read them.
// Abuse reports have their own form and queue (reports module).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isoOrNull = (date) => (date ? date.toISOString() : null);

function toAdminMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    replyEmail: row.reply_email,
    topic: row.topic,
    message: row.message,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    closedAt: isoOrNull(row.closed_at),
    closedBy: row.closed_by,
  };
}

export function createSupportService({ pool, cursorSecret, logger }) {
  const cursors = createCursorCodec(cursorSecret, 'admin-support-cursor-v1');

  // Guests must say where to reply; signed-in senders are answered at their account email.
  async function submit({ topic, message, email, userId = null }) {
    if (!userId && !email) throw validationError([{ path: 'email', message: 'Enter the email address we should reply to.' }]);

    await repository.insertMessage(pool, { userId, replyEmail: email ?? null, topic, message });

    logger?.info({ topic, signedIn: userId !== null }, 'support message received');
  }

  async function list({ status, cursor, limit }) {
    const scope = `support:${status}`;
    let after = null;

    if (cursor !== undefined) {
      after = cursors.decode(cursor, { ownerId: scope });

      if (!after) throw validationError([{ path: 'cursor', message: 'This page link is no longer valid. Start from the first page.' }]);
    }

    const rows = await repository.listMessages(pool, { status, after, limit: limit + 1 });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = rows.length > limit && last ? cursors.encode({ ownerId: scope, createdAt: last.created_at_cursor, id: last.id }) : null;

    return { items: items.map(toAdminMessage), nextCursor };
  }

  async function setStatus({ id, status, actorId }) {
    const row = UUID.test(id) ? await repository.updateStatus(pool, { id, status, actorId }) : null;

    if (!row) throw notFoundError();

    return toAdminMessage(row);
  }

  return { submit, list, setStatus };
}
