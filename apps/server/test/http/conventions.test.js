import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { RegisteredCreateLinkRequestSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { createApp } from '../../src/http/app.js';
import { validateBody } from '../../src/http/middleware/validate.js';
import { ALLOWED_ORIGIN, createCapturingLogger, startServer, testConfig } from '../support/http.js';

// Routes that exist only in this test, to exercise the shared conventions.
function testRouter() {
  const router = Router();

  router.post('/echo', validateBody(RegisteredCreateLinkRequestSchema), (req, res) => {
    res.status(201).json(req.body);
  });

  router.get('/boom', () => {
    throw new Error('database password is hunter2');
  });

  router.get('/boom-async', async () => {
    throw new Error('async failure with token abc123');
  });

  return router;
}

describe('API conventions', () => {
  const { logger, lines } = createCapturingLogger();
  let server;

  before(async () => {
    const app = createApp({ config: testConfig(), logger, routers: [testRouter()] });

    server = await startServer(app);
  });

  after(async () => {
    await server.close();
  });

  function post(path, body, headers = {}) {
    return fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  test('valid bodies reach the handler as parsed data', async () => {
    const response = await post('/echo', { destinationUrl: 'https://example.com' });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { destinationUrl: 'https://example.com' });
  });

  test('unknown write fields are rejected with a field list and no submitted values', async () => {
    const response = await post('/echo', {
      destinationUrl: 'https://example.com',
      ownerId: 'someone-else',
      role: 'admin',
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    assert.deepEqual(body.error.fields, [
      { path: 'ownerId', message: 'Unknown field.' },
      { path: 'role', message: 'Unknown field.' },
    ]);
    assert.equal(JSON.stringify(body).includes('someone-else'), false);
  });

  test('invalid field values are reported by path', async () => {
    const response = await post('/echo', { destinationUrl: 42 });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.fields[0].path, 'destinationUrl');
  });

  test('malformed JSON returns INVALID_JSON', async () => {
    const response = await post('/echo', '{"destinationUrl":');

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  });

  test('bodies over 16 KiB return PAYLOAD_TOO_LARGE', async () => {
    const response = await post('/echo', { destinationUrl: 'x'.repeat(17 * 1024) });

    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('non-JSON write bodies return UNSUPPORTED_MEDIA_TYPE', async () => {
    const response = await post('/echo', 'destinationUrl=x', { 'Content-Type': 'application/x-www-form-urlencoded' });

    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('state-changing requests from a foreign or missing Origin are rejected', async () => {
    const foreign = await post('/echo', { destinationUrl: 'https://example.com' }, { Origin: 'https://evil.example' });
    const missing = await fetch(`${server.url}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(missing.status, 403);
  });

  test('safe methods do not need an Origin', async () => {
    const response = await fetch(`${server.url}/missing`);

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  });

  test('unexpected errors return a generic 500 and are logged without secrets in the response', async () => {
    for (const path of ['/boom', '/boom-async']) {
      const response = await fetch(`${server.url}${path}`);
      const text = await response.text();

      assert.equal(response.status, 500);
      assert.equal(JSON.parse(text).error.code, 'INTERNAL_ERROR');
      assert.equal(/hunter2|abc123|at .*\.js/.test(text), false, 'response must not leak details or stacks');
    }

    const failures = lines.filter((line) => line.msg === 'request failed');

    assert.equal(failures.length, 2);
    assert.match(failures[0].err.stack, /conventions\.test\.js/);
  });

  test('every response has a request ID, no-store, and no X-Powered-By or automatic ETag', async () => {
    const responses = await Promise.all([
      fetch(`${server.url}/missing`),
      fetch(`${server.url}/boom`),
      post('/echo', { destinationUrl: 'https://example.com' }),
    ]);

    for (const response of responses) {
      assert.match(response.headers.get('x-request-id'), /^req_[0-9a-f-]{36}$/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.equal(response.headers.get('etag'), null);
    }

    const body = await responses[0].json();

    assert.equal(body.error.requestId, responses[0].headers.get('x-request-id'));
  });

  test('client-supplied request IDs are ignored', async () => {
    const forged = 'req_00000000-0000-0000-0000-000000000000';
    const response = await fetch(`${server.url}/missing`, { headers: { 'X-Request-Id': forged } });

    assert.notEqual(response.headers.get('x-request-id'), forged);
    assert.notEqual((await response.json()).error.requestId, forged);
  });

  test('request logs contain the path but never query strings or client IPs', async () => {
    await fetch(`${server.url}/missing?token=secret-reset-token&email=a@b.co`);

    const entry = lines.findLast((line) => line.msg === 'request finished' && line.path === '/missing');
    const serialized = JSON.stringify(entry);

    assert.ok(entry, 'expected a request log line');
    assert.equal(serialized.includes('secret-reset-token'), false);
    assert.equal(serialized.includes('127.0.0.1'), false);
    assert.equal(entry.status, 404);
  });
});
