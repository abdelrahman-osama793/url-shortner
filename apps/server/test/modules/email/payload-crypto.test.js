import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { decryptPayload, encryptPayload, parseOutboxKey } from '../../../src/modules/email/payload-crypto.js';

const key = randomBytes(32);
const payload = { to: 'person@example.com', token: 'secret-token-value' };

describe('outbox payload encryption', () => {
  test('round-trips and hides the plaintext', () => {
    const rowId = randomUUID();
    const encrypted = encryptPayload(key, rowId, payload);

    assert.deepEqual(decryptPayload(key, rowId, encrypted), payload);
    assert.equal(encrypted.includes(Buffer.from('secret-token-value')), false);
    assert.equal(encrypted.includes(Buffer.from('person@example.com')), false);
  });

  test('uses a fresh IV, so equal payloads encrypt differently', () => {
    const rowId = randomUUID();

    assert.notDeepEqual(encryptPayload(key, rowId, payload), encryptPayload(key, rowId, payload));
  });

  test('fails for another row, a tampered byte or another key', () => {
    const rowId = randomUUID();
    const encrypted = encryptPayload(key, rowId, payload);
    const tampered = Buffer.from(encrypted);

    tampered[tampered.length - 1] ^= 1;

    assert.throws(() => decryptPayload(key, randomUUID(), encrypted));
    assert.throws(() => decryptPayload(key, rowId, tampered));
    assert.throws(() => decryptPayload(randomBytes(32), rowId, encrypted));
  });

  test('accepts only 32-byte base64 keys', () => {
    assert.equal(parseOutboxKey(randomBytes(32).toString('base64')).length, 32);
    assert.throws(() => parseOutboxKey(randomBytes(16).toString('base64')), /32 bytes/);
    assert.throws(() => parseOutboxKey(undefined), /32 bytes/);
  });
});
