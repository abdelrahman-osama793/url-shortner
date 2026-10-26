import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { networkKey } from '../../../src/modules/abuse/client-address.js';

describe('networkKey', () => {
  test('uses the full IPv4 address', () => {
    assert.equal(networkKey('203.0.113.7'), 'ipv4:203.0.113.7');
  });

  test('treats IPv4-mapped IPv6 as the IPv4 address it contains', () => {
    assert.equal(networkKey('::ffff:203.0.113.7'), 'ipv4:203.0.113.7');
    assert.equal(networkKey('::FFFF:203.0.113.7'), 'ipv4:203.0.113.7');
  });

  test('groups IPv6 addresses by /64, so rotating the interface ID does not help', () => {
    const first = networkKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const second = networkKey('2001:db8:1:2::1');
    const otherNetwork = networkKey('2001:db8:1:3::1');

    assert.equal(first, 'ipv6:2001:0db8:0001:0002::/64');
    assert.equal(second, first);
    assert.notEqual(otherNetwork, first);
  });

  test('expands compressed and mixed-notation IPv6', () => {
    assert.equal(networkKey('::1'), 'ipv6:0000:0000:0000:0000::/64');
    assert.equal(networkKey('2001:DB8::'), 'ipv6:2001:0db8:0000:0000::/64');
    assert.equal(networkKey('64:ff9b::192.0.2.1'), 'ipv6:0064:ff9b:0000:0000::/64');
  });

  test('returns null for missing or malformed addresses', () => {
    for (const value of [undefined, null, '', 'not-an-ip', '999.1.1.1', '1.2.3']) {
      assert.equal(networkKey(value), null, String(value));
    }
  });
});
