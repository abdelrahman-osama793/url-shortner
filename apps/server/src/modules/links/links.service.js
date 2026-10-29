import { ALIAS_PATTERN, ERROR_CODES, GUEST_LINK_LIFETIME_DAYS } from '@shortlist/contracts';

import { AppError, notFoundError, validationError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';
import { hashRequest, runOnce } from '../idempotency/idempotency.service.js';

import { generateCode as generateRandomCode } from './rules/codes.js';
import { createCursorCodec } from './rules/cursor.js';
import { InvalidDestinationError, validateDestination } from './rules/destination.js';
import { toGuestLinkResource, toLinkResource } from './links.presenter.js';
import * as repository from './links.repository.js';

// A random 8-character Base62 code collides with an existing one only rarely, so a few
// retries make failure practically impossible while still bounding the work per request.
export const MAX_GENERATED_CODE_ATTEMPTS = 5;

const GUEST_LIFETIME_HOURS = GUEST_LINK_LIFETIME_DAYS * 24;

function aliasUnavailable() {
  // The same answer for "taken" and "reserved", so callers cannot probe the reserved list.
  return new AppError(409, ERROR_CODES.ALIAS_UNAVAILABLE, 'That alias is unavailable.');
}

function codeSpaceExhausted() {
  return new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Could not create a link right now. Please try again.', {
    headers: { 'Retry-After': '1' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function staleVersion() {
  return new AppError(412, ERROR_CODES.PRECONDITION_FAILED, 'This link was changed elsewhere. Reload it and try again.');
}

// Link creation, owner management and code reservation. Every dependency is injected: tests
// replace the code generator to force collisions and the clock to control "now".
// `cursorSecret` signs pagination cursors.
export function createLinkService({
  pool,
  publicBaseUrl,
  cursorSecret,
  logger,
  generateCode = generateRandomCode,
  clock = () => new Date(),
}) {
  const ownHosts = new Set([new URL(publicBaseUrl).hostname]);
  const cursors = cursorSecret ? createCursorCodec(cursorSecret) : null;

  function checkDestination(destinationUrl) {
    try {
      return validateDestination(destinationUrl, { ownHosts });
    } catch (error) {
      if (error instanceof InvalidDestinationError) {
        throw validationError([{ path: 'destinationUrl', message: error.message }]);
      }

      throw error;
    }
  }

  function checkAlias(customAlias) {
    if (!customAlias) return null;

    if (!ALIAS_PATTERN.test(customAlias)) {
      throw validationError([{ path: 'customAlias', message: 'Use 4-32 letters, digits, hyphens or underscores.' }]);
    }

    return customAlias;
  }

  function checkExpiry(expiresAt, now) {
    if (expiresAt === null || expiresAt === undefined) return null;

    const date = new Date(expiresAt);

    if (date <= now) {
      throw validationError([{ path: 'expiresAt', message: 'Choose a time in the future.' }]);
    }

    return date;
  }

  // The single allocation path for every code. Lock the exact code, refuse reserved codes,
  // then insert. Returns the new link id, or null when the code is unavailable.
  async function allocate(client, code, insert) {
    await repository.lockCode(client, code);

    if (await repository.isCodeReserved(client, code)) return null;

    return insert(code);
  }

  async function allocateGeneratedCode(client, insert) {
    for (let attempt = 1; attempt <= MAX_GENERATED_CODE_ATTEMPTS; attempt += 1) {
      const linkId = await allocate(client, generateCode(), insert);

      if (linkId) return linkId;
    }

    logger?.error({ attempts: MAX_GENERATED_CODE_ATTEMPTS }, 'generated code retries exhausted');

    throw codeSpaceExhausted();
  }

  // Guests: generated code, fixed seven-day expiry, no owner (decision D04).
  async function createGuestLink({ destinationUrl }) {
    const destination = checkDestination(destinationUrl);

    const row = await withTransaction(pool, async (client) => {
      const insert = (code) => repository.insertGuestLink(client, {
        code,
        destinationUrl: destination,
        lifetimeHours: GUEST_LIFETIME_HOURS,
      });

      const linkId = await allocateGeneratedCode(client, insert);

      return repository.findLinkById(client, linkId);
    }, { logger });

    return toGuestLinkResource(row, { publicBaseUrl });
  }

  // Validates an owner's request and returns the checked values, before any transaction starts.
  function checkOwnedRequest({ destinationUrl, customAlias, expiresAt }, now) {
    return {
      destination: checkDestination(destinationUrl),
      alias: checkAlias(customAlias),
      expiry: checkExpiry(expiresAt, now),
    };
  }

  // Allocates the code and inserts the link inside the caller's transaction. Returns the row.
  async function insertOwnedLink(client, { ownerId, destination, alias, expiry }) {
    const insert = (code) => repository.insertOwnedLink(client, {
      ownerId,
      code,
      isCustomAlias: alias !== null,
      destinationUrl: destination,
      expiresAt: expiry,
    });

    const linkId = alias !== null
      ? await allocate(client, alias, insert)
      : await allocateGeneratedCode(client, insert);

    if (!linkId) throw aliasUnavailable();

    return repository.findLinkById(client, linkId);
  }

  // Registered owners: optional custom alias and optional future expiry (D02, D10).
  // `ownerId` must come from an authenticated session (T11/T17), never from request input.
  async function createOwnedLink({ ownerId, destinationUrl, customAlias, expiresAt }) {
    const now = clock();
    const checked = checkOwnedRequest({ destinationUrl, customAlias, expiresAt }, now);

    const row = await withTransaction(pool, (client) => insertOwnedLink(client, { ownerId, ...checked }), { logger });

    return toLinkResource(row, { publicBaseUrl, now });
  }

  // Like createOwnedLink, but retry-safe when an Idempotency-Key is given (T18): the link and
  // the record of its 201 response commit together, and a retry with the same key and request
  // gets that original response back. Returns { response: { status, body, etag }, replayed }.
  async function createOwnedLinkOnce({ ownerId, idempotencyKey, destinationUrl, customAlias, expiresAt }) {
    if (!idempotencyKey) {
      const link = await createOwnedLink({ ownerId, destinationUrl, customAlias, expiresAt });

      return { replayed: false, response: { status: 201, body: link, etag: `"v${link.version}"` } };
    }

    const now = clock();
    const checked = checkOwnedRequest({ destinationUrl, customAlias, expiresAt }, now);

    const requestHash = hashRequest({
      destinationUrl: checked.destination,
      customAlias: checked.alias,
      expiresAt: checked.expiry ? checked.expiry.toISOString() : null,
    });

    return withTransaction(pool, (client) => runOnce(client, {
      userId: ownerId,
      key: idempotencyKey,
      requestHash,
      execute: async (transaction) => {
        const row = await insertOwnedLink(transaction, { ownerId, ...checked });
        const link = toLinkResource(row, { publicBaseUrl, now });

        return { linkId: link.id, response: { status: 201, body: link, etag: `"v${link.version}"` } };
      },
    }), { logger });
  }

  // Reserves a code (forbidden word or tombstone). Uses the same lock as allocation, so a
  // reservation and an allocation of one code can never both succeed.
  async function reserveCode({ code, reason }) {
    return withTransaction(pool, async (client) => {
      await repository.lockCode(client, code);

      if (await repository.isCodeAllocated(client, code)) {
        throw new AppError(409, ERROR_CODES.ALIAS_UNAVAILABLE, 'That code is already in use.');
      }

      return repository.insertReservation(client, { code, reason });
    }, { logger });
  }

  // An owner's links, newest first, one page at a time.
  // Returns { items, nextCursor }; nextCursor is null on the last page.
  async function listOwnedLinks({ ownerId, cursor, limit }) {
    if (!cursors) throw new Error('createLinkService needs cursorSecret to list links');

    const after = cursor ? cursors.decode(cursor, { ownerId }) : null;

    if (cursor && !after) {
      throw validationError([{ path: 'cursor', message: 'This page link is no longer valid. Start from the first page.' }]);
    }

    const rows = await repository.listOwnedLinks(pool, { ownerId, after, limit });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const now = clock();

    return {
      items: page.map((row) => toLinkResource(row, { publicBaseUrl, now })),
      nextCursor: rows.length > limit ? cursors.encode({ ownerId, createdAt: last.created_at_cursor, id: last.id }) : null,
    };
  }

  // Someone else's link, a guest link, an unknown id and a malformed id all look the same: 404.
  async function getOwnedLink({ ownerId, id }) {
    const row = UUID.test(id) ? await repository.findOwnedLink(pool, { ownerId, id }) : null;

    if (!row) throw notFoundError();

    return toLinkResource(row, { publicBaseUrl, now: clock() });
  }

  // Applies the owner's changes if the link is still at `expectedVersion` (from If-Match).
  // A newer version means someone else changed it: 412, never a silent overwrite. Enabling only
  // clears the owner's own "disabled" flag; blocks, expiry and suspension still apply.
  async function updateOwnedLink({ ownerId, id, expectedVersion, changes }) {
    if (!UUID.test(id)) throw notFoundError();

    const now = clock();
    const checked = { ...changes };

    if ('destinationUrl' in changes) checked.destinationUrl = checkDestination(changes.destinationUrl);
    if ('expiresAt' in changes) checked.expiresAt = checkExpiry(changes.expiresAt, now);

    const row = await withTransaction(pool, async (client) => {
      const newVersion = await repository.updateOwnedLink(client, { ownerId, id, expectedVersion, changes: checked });

      if (newVersion === null) {
        const exists = await repository.findOwnedLink(client, { ownerId, id });

        throw exists ? staleVersion() : notFoundError();
      }

      return repository.findOwnedLink(client, { ownerId, id });
    }, { logger });

    return toLinkResource(row, { publicBaseUrl, now });
  }

  return { createGuestLink, createOwnedLink, createOwnedLinkOnce, listOwnedLinks, getOwnedLink, updateOwnedLink, reserveCode };
}
