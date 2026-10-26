import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { InvalidDestinationError, validateDestination } from '../../../src/modules/links/destination.js';

const ownHosts = new Set(['shortlist.example']);

function check(url) {
  return validateDestination(url, { ownHosts });
}

function assertRejected(url, messagePattern) {
  assert.throws(() => check(url), (error) => {
    assert.ok(error instanceof InvalidDestinationError, `${url}: expected InvalidDestinationError, got ${error}`);
    if (messagePattern) assert.match(error.message, messagePattern, url);
    return true;
  });
}

describe('validateDestination', () => {
  test('accepts public http and https URLs and returns them normalised', () => {
    assert.equal(check('https://example.com/articles?id=1#top'), 'https://example.com/articles?id=1#top');
    assert.equal(check('  http://Example.COM  '), 'http://example.com/');
    assert.equal(check('https://sub.example.co.uk:8443/a b'), 'https://sub.example.co.uk:8443/a%20b');
    // Public IPv4 must pass: a mapped-IPv6 rule once blocked every IPv4 address.
    assert.equal(check('https://8.8.8.8/'), 'https://8.8.8.8/');
    assert.equal(check('https://1.1.1.1/'), 'https://1.1.1.1/');
    assert.equal(check('https://[2606:4700::1111]/'), 'https://[2606:4700::1111]/');
  });

  test('rejects empty and unparseable input', () => {
    assertRejected('', /Enter a URL/);
    assertRejected('   ', /Enter a URL/);
    assertRejected('example.com', /complete URL/);
    assertRejected('/relative/path', /complete URL/);
  });

  test('rejects non-web schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'file:///etc/passwd', 'mailto:a@b.co']) {
      assertRejected(url, /Only http/);
    }
  });

  test('rejects embedded credentials', () => {
    assertRejected('https://user:pass@example.com', /username or password/);
    assertRejected('https://user@example.com', /username or password/);
  });

  test('rejects control characters the URL parser would silently remove', () => {
    assertRejected('https://exa\nmple.com', /invalid characters/);
    assertRejected('https://example.com/a\tb', /invalid characters/);
    assertRejected('https://example.com/\u0000', /invalid characters/);
  });

  test('rejects localhost names', () => {
    for (const url of ['http://localhost', 'http://localhost.:3000', 'http://LOCALHOST/x', 'http://app.localhost']) {
      assertRejected(url, /private network/);
    }
  });

  test('rejects private, loopback, link-local and other non-public IPv4, including obfuscated forms', () => {
    for (const url of [
      'http://127.0.0.1',
      'http://127.1', // shorthand, parsed as 127.0.0.1
      'http://0x7f000001', // hex, parsed as 127.0.0.1
      'http://2130706433', // decimal, parsed as 127.0.0.1
      'http://10.1.2.3',
      'http://172.16.0.1',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://100.64.0.1',
      'http://0.0.0.0',
      'http://224.0.0.1',
      'http://255.255.255.255',
    ]) {
      assertRejected(url, /private network/);
    }
  });

  test('rejects non-public IPv6, including IPv4-mapped addresses', () => {
    for (const url of ['http://[::1]', 'http://[::]', 'http://[fe80::1]', 'http://[fd00::1]', 'http://[::ffff:127.0.0.1]', 'http://[::ffff:10.0.0.1]']) {
      assertRejected(url, /private network/);
    }
  });

  test('rejects single-label hostnames', () => {
    assertRejected('http://intranet/wiki', /public domain/);
  });

  test("rejects this service's own hostname to prevent redirect loops", () => {
    assertRejected('https://shortlist.example/r/abc12345', /cannot be shortened again/);
    assertRejected('https://SHORTLIST.example./r/x', /cannot be shortened again/);
  });

  test('rejects URLs longer than 4,096 characters after normalisation', () => {
    assert.ok(check(`https://example.com/${'a'.repeat(4000)}`));
    assertRejected(`https://example.com/${'a'.repeat(4096)}`, /at most 4096/);
    // Spaces expand to %20 when normalised, so a short input can exceed the limit.
    assertRejected(`https://example.com/${' '.repeat(1400)}x`, /at most 4096/);
  });
});
