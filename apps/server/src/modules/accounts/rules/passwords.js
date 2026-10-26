import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

// Argon2id with OWASP's recommended minimum (19 MiB memory, 2 iterations, 1 lane).
// Measured ~32 ms per hash on the development laptop. Hashing runs on libuv's thread pool, so
// at most UV_THREADPOOL_SIZE (default 4) hashes run at once per process; rate limits bound
// how many can queue.
const OPTIONS = Object.freeze({ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export function hashPassword(password) {
  return argon2.hash(password, OPTIONS);
}

// A real hash of a random secret, used when an account has no password so that a missing
// account takes as long to reject as a wrong password (no timing-based account discovery).
let dummyHash;

async function dummy() {
  dummyHash ??= await argon2.hash(randomBytes(32).toString('hex'), OPTIONS);

  return dummyHash;
}

// Returns { valid, rehash } where rehash is a new hash when the stored one uses outdated
// parameters (to be saved after a successful login), otherwise null.
export async function verifyPassword(storedHash, password) {
  if (!storedHash) {
    await argon2.verify(await dummy(), password);

    return { valid: false, rehash: null };
  }

  if (!(await argon2.verify(storedHash, password))) {
    return { valid: false, rehash: null };
  }

  const rehash = argon2.needsRehash(storedHash, OPTIONS) ? await hashPassword(password) : null;

  return { valid: true, rehash };
}
