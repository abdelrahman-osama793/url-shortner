import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeEmail } from '../../../src/modules/accounts/email.js';

describe('normalizeEmail', () => {
  test('trims and lower-cases', () => {
    assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
  });

  test('keeps dots and +suffixes: they may be different mailboxes', () => {
    assert.equal(normalizeEmail('first.last+news@example.com'), 'first.last+news@example.com');
  });

  test('converts internationalised domains to ASCII, so both spellings are one account', () => {
    assert.equal(normalizeEmail('user@Bücher.example'), 'user@xn--bcher-kva.example');
    assert.equal(normalizeEmail('user@xn--bcher-kva.example'), 'user@xn--bcher-kva.example');
  });
});
