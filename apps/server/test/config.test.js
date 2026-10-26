import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadConfig } from '../src/config.js';

const VALID_ENV = {
  DATABASE_URL: 'postgres://user:secret@localhost:5432/db',
  PUBLIC_BASE_URL: 'https://shortlist.example/',
};

describe('loadConfig', () => {
  test('applies defaults and derives allowed origins from the public URL', () => {
    const config = loadConfig(VALID_ENV);

    assert.equal(config.port, 3000);
    assert.equal(config.publicBaseUrl, 'https://shortlist.example');
    assert.deepEqual(config.allowedOrigins, ['https://shortlist.example']);
    assert.equal(config.trustProxyHops, 0);
    assert.ok(Object.isFrozen(config));
  });

  test('parses a comma-separated origin list into bare origins', () => {
    const config = loadConfig({ ...VALID_ENV, ALLOWED_ORIGINS: 'http://localhost:4200/, https://a.example' });

    assert.deepEqual(config.allowedOrigins, ['http://localhost:4200', 'https://a.example']);
  });

  test('fails with every problem listed and without echoing secret values', () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: 'mysql://user:secret@host/db', PORT: 'abc' }),
      (error) => {
        assert.match(error.message, /DATABASE_URL/);
        assert.match(error.message, /PUBLIC_BASE_URL/);
        assert.match(error.message, /PORT/);
        assert.equal(error.message.includes('secret'), false);
        return true;
      },
    );
  });
});
