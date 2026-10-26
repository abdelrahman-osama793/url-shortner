import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadConfig } from '../src/config.js';

const VALID_ENV = {
  DATABASE_URL: 'postgres://user:secret@localhost:5432/db',
  PUBLIC_BASE_URL: 'https://shortlist.example/',
  REDIS_URL: 'redis://localhost:6379',
  RATE_LIMIT_SECRET: 'x'.repeat(32),
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

  test('enables the development challenge provider outside production only', () => {
    assert.equal(loadConfig(VALID_ENV).challenge.provider, 'dev');

    assert.throws(
      () => loadConfig({ ...VALID_ENV, NODE_ENV: 'production' }),
      /no production challenge provider is configured/,
    );

    assert.throws(
      () => loadConfig({ ...VALID_ENV, NODE_ENV: 'production', CHALLENGE_PROVIDER: 'dev' }),
      /no production challenge provider is configured/,
    );
  });

  test('accepts rate-limit policy overrides and rejects malformed ones', () => {
    const config = loadConfig({
      ...VALID_ENV,
      RATE_LIMIT_POLICIES: '{"report":[{"subject":"network","limit":50,"windowSeconds":60}]}',
    });

    assert.deepEqual(config.rateLimit.policies.report, [{ subject: 'network', limit: 50, windowSeconds: 60 }]);
    assert.equal(config.rateLimit.policies.guestCreate.length, 2, 'other policies keep their defaults');

    assert.throws(() => loadConfig({ ...VALID_ENV, RATE_LIMIT_POLICIES: '{' }), /not valid JSON/);
    assert.throws(() => loadConfig({ ...VALID_ENV, RATE_LIMIT_POLICIES: '{"unknownPolicy":[]}' }), /RATE_LIMIT_POLICIES is invalid/);
    assert.throws(() => loadConfig({ ...VALID_ENV, RATE_LIMIT_POLICIES: '{"report":[{"subject":"network","limit":0,"windowSeconds":60}]}' }), /RATE_LIMIT_POLICIES is invalid/);
  });

  test('requires a rate-limit secret of at least 32 characters', () => {
    assert.throws(() => loadConfig({ ...VALID_ENV, RATE_LIMIT_SECRET: 'short' }), /RATE_LIMIT_SECRET/);
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
