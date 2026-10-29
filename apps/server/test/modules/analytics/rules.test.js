import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { countryCode } from '../../../src/modules/analytics/rules/country.js';
import { classifyDevice } from '../../../src/modules/analytics/rules/device.js';
import { DIRECT_OR_UNKNOWN, referrerHost } from '../../../src/modules/analytics/rules/referrer.js';

describe('classifyDevice', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'desktop'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 'desktop'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'mobile'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'tablet'],
    ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'tablet'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'bot'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'bot'],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'bot'],
    ['curl/8.5.0', 'bot'],
    ['python-requests/2.32.3', 'bot'],
    ['SomethingUnusual/1.0', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ];

  for (const [userAgent, expected] of cases) {
    test(`${expected}: ${String(userAgent).slice(0, 60)}`, () => {
      assert.equal(classifyDevice(userAgent), expected);
    });
  }
});

describe('referrerHost', () => {
  test('keeps only the lower-cased hostname', () => {
    assert.equal(referrerHost('https://News.Example.com:8443/story/42?utm=x#top'), 'news.example.com');
    assert.equal(referrerHost('http://example.org./'), 'example.org');
  });

  test('missing, malformed or non-web referrers are direct_or_unknown', () => {
    for (const value of [undefined, '', 'not a url', 'android-app://com.example', 'file:///etc/passwd', 'x'.repeat(5000)]) {
      assert.equal(referrerHost(value), DIRECT_OR_UNKNOWN, String(value).slice(0, 30));
    }
  });
});

describe('countryCode', () => {
  test('accepts ISO alpha-2 codes, upper-cased', () => {
    assert.equal(countryCode('EG'), 'EG');
    assert.equal(countryCode(' de '), 'DE');
  });

  test('anything else is unknown, including provider placeholders', () => {
    for (const value of [undefined, '', 'EGY', 'E1', 'XX', 'T1', 'A1', '<script>']) {
      assert.equal(countryCode(value), 'unknown', String(value));
    }
  });
});
