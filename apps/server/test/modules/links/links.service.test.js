import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { LinkSchema, GuestCreateLinkResponseSchema } from '@shortlist/contracts';

import { createLinkService, MAX_GENERATED_CODE_ATTEMPTS } from '../../../src/modules/links/links.service.js';
import { createMigratedDatabase } from '../../support/database.js';

const PUBLIC_BASE_URL = 'https://shortlist.example';
const HOUR_MS = 60 * 60 * 1000;

let database;

before(async () => {
  database = await createMigratedDatabase();
});

after(async () => {
  await database.drop();
});

function service(overrides = {}) {
  return createLinkService({ pool: database.pool, publicBaseUrl: PUBLIC_BASE_URL, ...overrides });
}

// Synthetic owner, created directly in the database. Only tests do this; real owners
// come from authenticated sessions (T11/T17).
async function createOwner(status = 'active') {
  const email = `${randomUUID()}@example.com`;

  const { rows } = await database.pool.query(
    'INSERT INTO users (email, email_normalized, status) VALUES ($1, $1, $2) RETURNING id',
    [email, status],
  );

  return rows[0].id;
}

async function assertAppError(promise, { status, code, field }) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status, `status: ${error.message}`);
    assert.equal(error.code, code);
    if (field) assert.equal(error.fields?.[0]?.path, field);
    return true;
  });
}

// Resolves to `success` or to the error code, so concurrent outcomes can be counted.
async function outcomeOf(promise, success) {
  try {
    await promise;
    return success;
  } catch (error) {
    return error.code;
  }
}

// A code generator that returns the given codes in order, then random ones.
function scriptedCodes(...codes) {
  return () => codes.shift() ?? randomUUID().replaceAll('-', '').slice(0, 8);
}

describe('guest links', () => {
  test('get a generated code, a public short URL and an expiry exactly seven days out', async () => {
    const startedAt = Date.now();
    const link = await service().createGuestLink({ destinationUrl: 'https://example.com/page' });

    GuestCreateLinkResponseSchema.parse(link);

    assert.match(link.code, /^[0-9A-Za-z]{8}$/);
    assert.equal(link.shortUrl, `${PUBLIC_BASE_URL}/r/${link.code}`);
    assert.deepEqual(Object.keys(link).sort(), ['code', 'expiresAt', 'shortUrl']);

    const { rows } = await database.pool.query(
      'SELECT owner_id, is_custom_alias, extract(epoch FROM expires_at - created_at)::int AS lifetime_seconds FROM links WHERE code = $1',
      [link.code],
    );

    assert.equal(rows[0].owner_id, null);
    assert.equal(rows[0].is_custom_alias, false);
    assert.equal(rows[0].lifetime_seconds, 168 * 60 * 60);
    assert.ok(Math.abs(new Date(link.expiresAt) - (startedAt + 168 * HOUR_MS)) < 60_000);
  });

  test('reject invalid destinations as a field error', async () => {
    await assertAppError(service().createGuestLink({ destinationUrl: 'http://127.0.0.1/admin' }), {
      status: 400, code: 'VALIDATION_FAILED', field: 'destinationUrl',
    });

    await assertAppError(service().createGuestLink({ destinationUrl: `${PUBLIC_BASE_URL}/r/loop` }), {
      status: 400, code: 'VALIDATION_FAILED', field: 'destinationUrl',
    });
  });
});

describe('owned links', () => {
  test('accept a custom alias and an optional future expiry', async () => {
    const ownerId = await createOwner();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * HOUR_MS).toISOString();

    const link = await service({ clock: () => now }).createOwnedLink({
      ownerId,
      destinationUrl: 'https://example.com/articles/system-design',
      customAlias: 'system-design',
      expiresAt,
    });

    LinkSchema.parse(link);

    assert.equal(link.code, 'system-design');
    assert.equal(link.shortUrl, `${PUBLIC_BASE_URL}/r/system-design`);
    assert.equal(link.expiresAt, expiresAt);
    assert.equal(link.enabled, true);
    assert.equal(link.effectiveStatus, 'active');
    assert.equal(link.version, 1);
  });

  test('never expire by default (decision D10)', async () => {
    const link = await service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com' });

    assert.equal(link.expiresAt, null);
    assert.match(link.code, /^[0-9A-Za-z]{8}$/);
  });

  test('reject an expiry that is not in the future, using server time', async () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const linkService = service({ clock: () => now });
    const ownerId = await createOwner();

    for (const expiresAt of ['2026-10-26T12:00:00Z', '2026-01-01T00:00:00Z']) {
      await assertAppError(linkService.createOwnedLink({ ownerId, destinationUrl: 'https://example.com', expiresAt }), {
        status: 400, code: 'VALIDATION_FAILED', field: 'expiresAt',
      });
    }
  });

  test('report the effective status of a suspended owner', async () => {
    const link = await service().createOwnedLink({
      ownerId: await createOwner('suspended'),
      destinationUrl: 'https://example.com',
    });

    assert.equal(link.effectiveStatus, 'ownerSuspended');
  });

  test('reject malformed aliases before touching the database', async () => {
    await assertAppError(
      service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com', customAlias: 'no spaces' }),
      { status: 400, code: 'VALIDATION_FAILED', field: 'customAlias' },
    );
  });
});

describe('aliases', () => {
  test('are case-sensitive: Portfolio and portfolio are different codes', async () => {
    const ownerId = await createOwner();
    const linkService = service();

    await linkService.createOwnedLink({ ownerId, destinationUrl: 'https://example.com/a', customAlias: 'Portfolio' });
    await linkService.createOwnedLink({ ownerId, destinationUrl: 'https://example.com/b', customAlias: 'portfolio' });

    await assertAppError(
      linkService.createOwnedLink({ ownerId, destinationUrl: 'https://example.com/c', customAlias: 'Portfolio' }),
      { status: 409, code: 'ALIAS_UNAVAILABLE' },
    );
  });

  test('cannot use a reserved word, and get the same answer as for a taken alias', async () => {
    await assert.rejects(
      service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com', customAlias: 'admin' }),
      { status: 409, code: 'ALIAS_UNAVAILABLE', message: 'That alias is unavailable.' },
    );
  });

  test('share one namespace with generated codes', async () => {
    const ownerId = await createOwner();
    const generated = await service({ generateCode: scriptedCodes('Shared01') }).createGuestLink({ destinationUrl: 'https://example.com' });

    await assertAppError(
      service().createOwnedLink({ ownerId, destinationUrl: 'https://example.com', customAlias: generated.code }),
      { status: 409, code: 'ALIAS_UNAVAILABLE' },
    );
  });
});

describe('concurrent allocation', () => {
  test('of one alias by many requests creates exactly one link', async () => {
    const ownerIds = await Promise.all(Array.from({ length: 5 }, () => createOwner()));

    const attempts = Array.from({ length: 30 }, (_, i) => outcomeOf(
      service().createOwnedLink({ ownerId: ownerIds[i % 5], destinationUrl: `https://example.com/${i}`, customAlias: 'race-alias' }),
      'created',
    ));

    const outcomes = await Promise.all(attempts);

    assert.equal(outcomes.filter((outcome) => outcome === 'created').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === 'ALIAS_UNAVAILABLE').length, 29);

    const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM links WHERE code = 'race-alias'");

    assert.equal(rows[0].n, 1);
  });

  test('of a reservation and an alias for the same code never lets both succeed', async () => {
    const ownerId = await createOwner();

    for (let round = 0; round < 20; round += 1) {
      const code = `contested-${round}`;

      const [allocation, reservation] = await Promise.all([
        outcomeOf(service().createOwnedLink({ ownerId, destinationUrl: 'https://example.com', customAlias: code }), 'allocated'),
        outcomeOf(service().reserveCode({ code, reason: 'forbidden' }), 'reserved'),
      ]);

      const winners = [allocation, reservation].filter((outcome) => outcome === 'allocated' || outcome === 'reserved');

      assert.equal(winners.length, 1, `round ${round}: ${allocation} / ${reservation}`);
    }
  });
});

describe('generated code collisions', () => {
  test('are retried with a new code', async () => {
    const taken = await service({ generateCode: scriptedCodes('Collide1') }).createGuestLink({ destinationUrl: 'https://example.com' });

    const link = await service({ generateCode: scriptedCodes(taken.code, taken.code, 'Fresh001') })
      .createGuestLink({ destinationUrl: 'https://example.com' });

    assert.equal(link.code, 'Fresh001');
  });

  test('skip reserved codes too', async () => {
    const link = await service({ generateCode: scriptedCodes('shortlist', 'NotReserved1') })
      .createGuestLink({ destinationUrl: 'https://example.com' });

    assert.equal(link.code, 'NotReserved1');
  });

  test(`give up after ${MAX_GENERATED_CODE_ATTEMPTS} attempts with a retryable 503 and leave nothing behind`, async () => {
    const taken = await service({ generateCode: scriptedCodes('Always01') }).createGuestLink({ destinationUrl: 'https://example.com' });
    let calls = 0;

    const alwaysTaken = () => {
      calls += 1;
      return taken.code;
    };

    const { rows: beforeRows } = await database.pool.query('SELECT count(*)::int AS n FROM links');

    await assert.rejects(
      service({ generateCode: alwaysTaken }).createGuestLink({ destinationUrl: 'https://example.com' }),
      (error) => error.status === 503 && error.headers['Retry-After'] === '1',
    );

    const { rows: afterRows } = await database.pool.query('SELECT count(*)::int AS n FROM links');

    assert.equal(calls, MAX_GENERATED_CODE_ATTEMPTS);
    assert.equal(afterRows[0].n, beforeRows[0].n);
  });
});

describe('reservations', () => {
  test('cannot reserve a code that is already allocated', async () => {
    await service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com', customAlias: 'in-use' });

    await assertAppError(service().reserveCode({ code: 'in-use', reason: 'tombstone' }), { status: 409, code: 'ALIAS_UNAVAILABLE' });
  });

  test('block later allocation of that code', async () => {
    assert.equal(await service().reserveCode({ code: 'brand-word', reason: 'forbidden' }), true);

    await assertAppError(
      service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com', customAlias: 'brand-word' }),
      { status: 409, code: 'ALIAS_UNAVAILABLE' },
    );
  });
});

describe('link identity in the database', () => {
  const INSUFFICIENT_PRIVILEGE = '42501';

  async function createLink() {
    const link = await service().createOwnedLink({ ownerId: await createOwner(), destinationUrl: 'https://example.com' });

    return link.id;
  }

  test('code, owner, alias flag and creation time cannot be changed', async () => {
    const id = await createLink();
    const otherOwner = await createOwner();

    for (const [sql, params] of [
      ["UPDATE links SET code = 'renamed1' WHERE id = $1", [id]],
      ['UPDATE links SET owner_id = $2 WHERE id = $1', [id, otherOwner]],
      ['UPDATE links SET owner_id = NULL WHERE id = $1', [id]],
      ['UPDATE links SET is_custom_alias = true WHERE id = $1', [id]],
      ["UPDATE links SET created_at = created_at - interval '1 day' WHERE id = $1", [id]],
    ]) {
      await assert.rejects(database.pool.query(sql, params), { code: INSUFFICIENT_PRIVILEGE }, sql);
    }
  });

  test('editable fields can still change', async () => {
    const id = await createLink();

    await database.pool.query(
      "UPDATE links SET destination_url = 'https://example.org', owner_disabled_at = now(), version = version + 1 WHERE id = $1",
      [id],
    );
  });

  test('links cannot be deleted or truncated, so codes are never freed for reuse', async () => {
    const id = await createLink();

    await assert.rejects(database.pool.query('DELETE FROM links WHERE id = $1', [id]), { code: INSUFFICIENT_PRIVILEGE });
    await assert.rejects(database.pool.query('TRUNCATE links CASCADE'), { code: INSUFFICIENT_PRIVILEGE });
  });
});
