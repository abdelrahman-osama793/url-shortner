import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { withTransaction } from '../../../src/infra/postgres.js';
import { consumeToken, issueToken, issueTokenWithEmail } from '../../../src/modules/accounts/tokens.service.js';
import { createMigratedDatabase } from '../../support/database.js';

const HOUR = 60 * 60 * 1000;

let database;

before(async () => {
  database = await createMigratedDatabase();
});

after(async () => {
  await database.drop();
});

async function createUser() {
  const email = `${randomUUID()}@example.com`;
  const { rows } = await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id', [email]);

  return { id: rows[0].id, email };
}

function issue(user, purpose = 'verification', lifetimeMs = HOUR) {
  return withTransaction(database.pool, (client) => issueToken(client, { userId: user.id, purpose, lifetimeMs }));
}

function consume(token, purpose = 'verification') {
  return withTransaction(database.pool, (client) => consumeToken(client, { token, purpose }));
}

describe('one-time tokens', () => {
  test('store only a SHA-256 hash of a 256-bit token', async () => {
    const user = await createUser();
    const { token } = await issue(user);

    assert.equal(Buffer.from(token, 'base64url').length, 32);

    const { rows } = await database.pool.query('SELECT token_hash FROM auth_tokens WHERE user_id = $1', [user.id]);

    assert.deepEqual(rows[0].token_hash, createHash('sha256').update(token).digest());
    assert.equal(rows[0].token_hash.includes(Buffer.from(token)), false);
  });

  test('can be used exactly once', async () => {
    const user = await createUser();
    const { token } = await issue(user);

    assert.deepEqual(await consume(token), { ok: true, userId: user.id });
    assert.deepEqual(await consume(token), { ok: false, reason: 'used' });
  });

  test('report expired tokens as expired', async () => {
    const user = await createUser();
    const { token } = await issue(user);

    await database.pool.query("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", [user.id]);

    assert.deepEqual(await consume(token), { ok: false, reason: 'expired' });
  });

  test('are bound to their purpose', async () => {
    const { token } = await issue(await createUser(), 'verification');

    assert.deepEqual(await consume(token, 'reset'), { ok: false, reason: 'invalid' });
    assert.equal((await consume(token, 'verification')).ok, true);
  });

  test('reject unknown, empty and oversized values', async () => {
    for (const token of [randomBytes(32).toString('base64url'), '', 'x'.repeat(129), undefined]) {
      assert.deepEqual(await consume(token), { ok: false, reason: 'invalid' });
    }
  });

  test('a newer token revokes older unused ones of the same purpose', async () => {
    const user = await createUser();
    const older = await issue(user, 'reset');
    const otherPurpose = await issue(user, 'verification');
    const newer = await issue(user, 'reset');

    assert.deepEqual(await consume(older.token, 'reset'), { ok: false, reason: 'used' });
    assert.equal((await consume(newer.token, 'reset')).ok, true);
    assert.equal((await consume(otherPurpose.token, 'verification')).ok, true, 'other purposes are untouched');
  });

  test('concurrent consumption succeeds exactly once', async () => {
    const { token } = await issue(await createUser());

    const results = await Promise.all(Array.from({ length: 10 }, () => consume(token)));

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.reason === 'used').length, 9);
  });

  test('a rolled-back consumption leaves the token usable', async () => {
    const { token } = await issue(await createUser());
    const failure = new Error('account update failed');

    await assert.rejects(withTransaction(database.pool, async (client) => {
      await consumeToken(client, { token, purpose: 'verification' });
      throw failure;
    }), (error) => error === failure);

    assert.equal((await consume(token)).ok, true);
  });
});

describe('issueTokenWithEmail', () => {
  const key = randomBytes(32);

  test('writes the token and its outbox message together', async () => {
    const user = await createUser();

    const messageId = await withTransaction(database.pool, (client) => issueTokenWithEmail(client, { key, user, purpose: 'reset', lifetimeMs: HOUR }));

    const { rows } = await database.pool.query('SELECT kind, user_id, expires_at FROM email_outbox WHERE id = $1', [messageId]);
    const { rows: tokens } = await database.pool.query('SELECT expires_at FROM auth_tokens WHERE user_id = $1', [user.id]);

    assert.equal(rows[0].kind, 'reset');
    assert.equal(rows[0].user_id, user.id);
    assert.deepEqual(rows[0].expires_at, tokens[0].expires_at, 'the message expires with its token');
  });

  test('leaves neither behind when the transaction rolls back', async () => {
    const user = await createUser();

    await assert.rejects(withTransaction(database.pool, async (client) => {
      await issueTokenWithEmail(client, { key, user, purpose: 'verification', lifetimeMs: HOUR });
      throw new Error('registration failed later');
    }));

    const { rows } = await database.pool.query(
      `SELECT (SELECT count(*) FROM auth_tokens WHERE user_id = $1)::int AS tokens,
              (SELECT count(*) FROM email_outbox WHERE user_id = $1)::int AS messages`,
      [user.id],
    );

    assert.deepEqual(rows[0], { tokens: 0, messages: 0 });
  });
});
