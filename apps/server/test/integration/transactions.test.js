import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { withTransaction } from '../../src/infra/postgres.js';
import { createTestDatabase } from '../support/database.js';

describe('withTransaction', () => {
  let database;

  before(async () => {
    database = await createTestDatabase();

    await database.pool.query('CREATE TABLE items (name text PRIMARY KEY)');
  });

  after(async () => {
    await database.drop();
  });

  async function itemExists(name) {
    const { rowCount } = await database.pool.query('SELECT 1 FROM items WHERE name = $1', [name]);

    return rowCount === 1;
  }

  test('commits and returns the result when the work succeeds', async () => {
    const result = await withTransaction(database.pool, async (client) => {
      await client.query("INSERT INTO items VALUES ('committed')");

      return 'done';
    });

    assert.equal(result, 'done');
    assert.equal(await itemExists('committed'), true);
  });

  test('rolls back every statement and re-throws the original error when the work fails', async () => {
    const failure = new Error('work failed');

    await assert.rejects(
      withTransaction(database.pool, async (client) => {
        await client.query("INSERT INTO items VALUES ('rolled-back')");

        throw failure;
      }),
      (error) => error === failure,
    );

    assert.equal(await itemExists('rolled-back'), false);
  });

  test('returns the connection to the pool after a failure', async () => {
    const attempts = Array.from({ length: 10 }, () => withTransaction(database.pool, async () => {
      throw new Error('fail');
    }).catch(() => 'failed'));

    assert.deepEqual(new Set(await Promise.all(attempts)), new Set(['failed']));

    // The pool has 5 connections; 10 failures would exhaust it if any leaked.
    assert.equal(await withTransaction(database.pool, async () => 'still usable'), 'still usable');
  });

  test('read-only transactions reject writes', async () => {
    await assert.rejects(
      withTransaction(database.pool, (client) => client.query("INSERT INTO items VALUES ('nope')"), { readOnly: true }),
      { code: '25006' },
    );
  });

  test('rejects unknown isolation levels before touching the database', async () => {
    await assert.rejects(
      withTransaction(database.pool, async () => {}, { isolationLevel: 'READ COMMITTED; DROP TABLE items' }),
      /Unsupported isolation level/,
    );

    assert.equal(await itemExists('committed'), true);
  });
});
