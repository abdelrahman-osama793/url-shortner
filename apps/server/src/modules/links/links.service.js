import { ALIAS_PATTERN, ERROR_CODES, GUEST_LINK_LIFETIME_DAYS } from '@shortlist/contracts';

import { AppError, validationError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';

import { generateCode as generateRandomCode } from './rules/codes.js';
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

// Link creation and code reservation. Every dependency is injected: tests replace the
// code generator to force collisions and the clock to control "now".
export function createLinkService({ pool, publicBaseUrl, logger, generateCode = generateRandomCode, clock = () => new Date() }) {
  const ownHosts = new Set([new URL(publicBaseUrl).hostname]);

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

  // Registered owners: optional custom alias and optional future expiry (D02, D10).
  // `ownerId` must come from an authenticated session (T11/T17), never from request input.
  async function createOwnedLink({ ownerId, destinationUrl, customAlias, expiresAt }) {
    const now = clock();
    const destination = checkDestination(destinationUrl);
    const alias = checkAlias(customAlias);
    const expiry = checkExpiry(expiresAt, now);
    const isCustomAlias = alias !== null;

    const row = await withTransaction(pool, async (client) => {
      const insert = (code) => repository.insertOwnedLink(client, {
        ownerId,
        code,
        isCustomAlias,
        destinationUrl: destination,
        expiresAt: expiry,
      });

      const linkId = isCustomAlias
        ? await allocate(client, alias, insert)
        : await allocateGeneratedCode(client, insert);

      if (!linkId) throw aliasUnavailable();

      return repository.findLinkById(client, linkId);
    }, { logger });

    return toLinkResource(row, { publicBaseUrl, now });
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

  return { createGuestLink, createOwnedLink, reserveCode };
}
