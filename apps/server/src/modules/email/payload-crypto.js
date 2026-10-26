import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypts outbox payloads (recipient and one-time token) at rest with AES-256-GCM.
// Layout: version (1 byte) | IV (12 bytes) | auth tag (16 bytes) | ciphertext.
// The outbox row id is the additional authenticated data, so a payload copied into another
// row fails to decrypt. The version byte leaves room for key rotation later.

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseOutboxKey(base64Key) {
  const key = Buffer.from(base64Key ?? '', 'base64');

  if (key.length !== 32) {
    throw new Error('EMAIL_OUTBOX_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  }

  return key;
}

export function encryptPayload(key, rowId, payload) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  cipher.setAAD(Buffer.from(rowId));

  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);

  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

// Throws if the data was tampered with, belongs to another row or used another key.
export function decryptPayload(key, rowId, data) {
  if (data[0] !== VERSION) throw new Error(`unsupported outbox payload version ${data[0]}`);

  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAAD(Buffer.from(rowId));
  decipher.setAuthTag(tag);

  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}
