import { randomUUID } from 'node:crypto';

import { SESSION_COOKIE } from '../../src/http/middleware/session.js';

import { newBrowser } from './browser.js';

// A signed-in browser for a synthetic account created directly in the database. Only tests do
// this; real accounts come from sign-up and sign-in. `api` is the result of startTestApi().
export async function signedInOwner({ database, api, verified = true }) {
  const email = `${randomUUID()}@example.com`;

  const { rows } = await database.pool.query(
    `INSERT INTO users (email, email_normalized, email_verified_at)
     VALUES ($1, $1, $2)
     RETURNING id, role, session_version`,
    [email, verified ? new Date() : null],
  );

  const user = { id: rows[0].id, role: rows[0].role, sessionVersion: rows[0].session_version };
  const { token, session } = await api.sessionService.rotate(null, user);
  const browser = await newBrowser(api.server);

  browser.cookie = `${SESSION_COOKIE}=${token}`;
  browser.csrfToken = session.csrfToken;
  browser.userId = user.id;

  return browser;
}
