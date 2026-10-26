import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { generateCode } from '../../../src/modules/links/rules/codes.js';
import { effectiveStatus } from '../../../src/modules/links/rules/status.js';

describe('generateCode', () => {
  test('produces 8 Base62 characters', () => {
    for (let i = 0; i < 1000; i += 1) {
      assert.match(generateCode(), /^[0-9A-Za-z]{8}$/);
    }
  });

  test('uses every Base62 character with roughly equal frequency', () => {
    const counts = new Map();
    const samples = 20_000;

    for (let i = 0; i < samples; i += 1) {
      for (const char of generateCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const expected = (samples * 8) / 62;

    assert.equal(counts.size, 62);

    // Each count should sit within ±15% of the mean; a biased generator drifts much further.
    for (const [char, count] of counts) {
      assert.ok(Math.abs(count - expected) / expected < 0.15, `${char} appeared ${count} times, expected ~${expected}`);
    }
  });
});

describe('effectiveStatus', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const past = new Date('2026-10-01T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');

  const active = { adminBlockedAt: null, ownerStatus: 'active', ownerDisabledAt: null, expiresAt: null };

  test('follows blocked → ownerSuspended → disabled → expired → active', () => {
    const cases = [
      [{ adminBlockedAt: past, ownerStatus: 'suspended', ownerDisabledAt: past, expiresAt: past }, 'blocked'],
      [{ ownerStatus: 'suspended', ownerDisabledAt: past, expiresAt: past }, 'ownerSuspended'],
      [{ ownerDisabledAt: past, expiresAt: past }, 'disabled'],
      [{ expiresAt: past }, 'expired'],
      [{ expiresAt: future }, 'active'],
      [{}, 'active'],
    ];

    for (const [overrides, expected] of cases) {
      assert.equal(effectiveStatus({ ...active, ...overrides }, now), expected, JSON.stringify(overrides));
    }
  });

  test('a link expires exactly at its expiry time, using the supplied server time', () => {
    assert.equal(effectiveStatus({ ...active, expiresAt: now }, now), 'expired');
    assert.equal(effectiveStatus({ ...active, expiresAt: new Date(now.getTime() + 1) }, now), 'active');
  });

  test('guest links (no owner) are never owner-suspended', () => {
    assert.equal(effectiveStatus({ ...active, ownerStatus: null, expiresAt: future }, now), 'active');
  });

  test('clearing a block reveals the next applicable state, not active', () => {
    assert.equal(effectiveStatus({ ...active, adminBlockedAt: null, expiresAt: past }, now), 'expired');
    assert.equal(effectiveStatus({ ...active, adminBlockedAt: null, ownerDisabledAt: past }, now), 'disabled');
  });
});
