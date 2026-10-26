import { OAuth2Client } from 'google-auth-library';

// Verifies Google Identity Services ID tokens ("credentials") on the server
// (technical-design §4; https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
// The library checks the RS256 signature against Google's published keys, the issuer, the
// audience and the expiry. The audience is always our configured client ID, never a value
// supplied by the browser. The nonce check binds the token to one sign-in attempt.

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// The token itself is unacceptable: forged, expired, for another app, or for another attempt.
export class GoogleCredentialRejectedError extends Error {
  constructor(reason, cause) {
    super(`google credential rejected: ${reason}`, { cause });
    this.name = 'GoogleCredentialRejectedError';
    this.reason = reason;
  }
}

// Google's signing keys could not be fetched, so nothing can be verified right now.
export class GoogleUnavailableError extends Error {
  constructor(cause) {
    super('google signing keys are unavailable', { cause });
    this.name = 'GoogleUnavailableError';
  }
}

// `getCertificates` defaults to Google's published keys (cached by the library according to
// Google's cache headers). Tests inject their own keys to exercise the same verification code.
export function createGoogleIdentityService({ clientId, getCertificates }) {
  const client = new OAuth2Client({ clientId });

  const certificates = getCertificates ?? (async () => (await client.getFederatedSignonCertsAsync()).certs);

  async function loadCertificates() {
    try {
      return await certificates();
    } catch (error) {
      throw new GoogleUnavailableError(error);
    }
  }

  // Returns { subject, email, emailVerified, hostedDomain } for a valid token issued for
  // `nonce`; otherwise throws GoogleCredentialRejectedError.
  async function verify(credential, { nonce }) {
    const certs = await loadCertificates();

    let payload;

    try {
      const ticket = await client.verifySignedJwtWithCertsAsync(credential, certs, clientId, GOOGLE_ISSUERS);

      payload = ticket.getPayload();
    } catch (error) {
      throw new GoogleCredentialRejectedError('invalid token', error);
    }

    if (!payload?.sub) throw new GoogleCredentialRejectedError('missing subject');
    if (!nonce || payload.nonce !== nonce) throw new GoogleCredentialRejectedError('nonce mismatch');

    return {
      subject: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      hostedDomain: payload.hd ?? null,
    };
  }

  return { verify };
}
