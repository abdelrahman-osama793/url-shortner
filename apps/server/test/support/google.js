import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

import { createGoogleIdentityService } from '../../src/modules/accounts/google-identity.service.js';

export const TEST_GOOGLE_CLIENT_ID = '123456789012-testclientidabcdef.apps.googleusercontent.com';

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function newKey() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

// Issues RS256 ID tokens shaped like Google's and verifies them with the application's real
// verification code (createGoogleIdentityService), using a local key instead of Google's keys.
// Nothing here talks to Google: the real-account check is a separate manual step.
export function createTestGoogle({ clientId = TEST_GOOGLE_CLIENT_ID } = {}) {
  const trusted = newKey();
  const untrusted = newKey();
  const keyId = 'test-key-1';

  let unavailable = false;

  const identity = createGoogleIdentityService({
    clientId,
    getCertificates: async () => {
      if (unavailable) throw new Error('simulated: cannot reach Google key endpoint');

      return { [keyId]: trusted.publicKey.export({ type: 'spki', format: 'pem' }) };
    },
  });

  // `claims` override the defaults; `signWith: 'untrusted'` signs with a key Google never published.
  function issue(claims = {}, { signWith = 'trusted' } = {}) {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: `google-${randomUUID()}`,
      email: `person-${randomUUID()}@gmail.com`,
      email_verified: true,
      iat: now,
      exp: now + 3600,
      ...claims,
    };

    const unsigned = `${base64url({ alg: 'RS256', kid: keyId, typ: 'JWT' })}.${base64url(payload)}`;
    const key = signWith === 'trusted' ? trusted.privateKey : untrusted.privateKey;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');

    return { credential: `${unsigned}.${signature}`, payload };
  }

  return {
    identity,
    issue,
    setUnavailable: (value) => {
      unavailable = value;
    },
  };
}
