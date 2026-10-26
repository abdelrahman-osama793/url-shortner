import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createCapturingLogger } from '../support/http.js';

describe('logger redaction', () => {
  test('secret fields are redacted at the top level and when nested', () => {
    const { logger, lines } = createCapturingLogger();

    logger.info({
      password: 'top-secret',
      body: { newPassword: 'nested-secret', token: 'reset-token' },
      headers: { cookie: '__Host-session=abc', authorization: 'Bearer xyz', 'x-csrf-token': 'csrf' },
    }, 'attempt');

    const serialized = JSON.stringify(lines[0]);

    for (const secret of ['top-secret', 'nested-secret', 'reset-token', '__Host-session=abc', 'Bearer xyz', '"csrf"']) {
      assert.equal(serialized.includes(secret), false, `${secret} leaked: ${serialized}`);
    }

    assert.equal(lines[0].password, '[REDACTED]');
    assert.equal(lines[0].headers['x-csrf-token'], '[REDACTED]');
  });

  test('credentials inside connection strings are removed from error messages and stacks', () => {
    const { logger, lines } = createCapturingLogger();
    const error = new Error('connect failed for postgres://shortlist:s3cret-pass@postgres:5432/shortlist');

    logger.error({ err: error }, 'database error');

    const serialized = JSON.stringify(lines[0]);

    assert.equal(serialized.includes('s3cret-pass'), false);
    assert.match(lines[0].err.message, /postgres:\/\/shortlist:\[REDACTED\]@postgres/);
  });

  test('errors keep type, message and stack but drop attached objects', () => {
    const { logger, lines } = createCapturingLogger();
    const error = Object.assign(new Error('failed'), { config: { connectionString: 'secret' }, code: 'E1' });

    logger.error({ err: error }, 'failure');

    assert.deepEqual(Object.keys(lines[0].err).sort(), ['code', 'message', 'stack', 'type']);
  });
});
