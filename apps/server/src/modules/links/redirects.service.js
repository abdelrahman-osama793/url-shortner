import { ALIAS_PATTERN } from '@shortlist/contracts';

import * as linksRepository from './links.repository.js';
import { effectiveStatus } from './rules/status.js';

// Resolves a short code to a redirect decision (technical-design §4, "Resolve a short link").
//
// Consistency (decision D12): every lookup is one fresh READ COMMITTED statement on the
// PostgreSQL primary, with no cache in between. Any update committed before this statement
// starts is visible to it, so edits and disables apply to every request received after the
// update's success response.
//
// Load: the pool caps concurrent lookups at its size and waits at most its connection
// timeout. When too many requests are already waiting for a connection, new ones are shed
// immediately instead of growing an unbounded queue.

export class RedirectUnavailableError extends Error {
  constructor(reason, cause) {
    super(`redirect lookup unavailable: ${reason}`, { cause });
    this.name = 'RedirectUnavailableError';
    this.reason = reason;
  }
}

export function createRedirectService({ pool, maxWaiting = 50 }) {
  // Returns { outcome: 'redirect', destination } | { outcome: 'missing' } | { outcome: 'inactive' }.
  // Throws RedirectUnavailableError when overloaded or when PostgreSQL fails.
  async function resolve(code) {
    // Malformed or overlong codes can never exist, so they never reach the database.
    if (typeof code !== 'string' || !ALIAS_PATTERN.test(code)) {
      return { outcome: 'missing' };
    }

    if (pool.waitingCount >= maxWaiting) {
      throw new RedirectUnavailableError('overloaded');
    }

    let link;

    try {
      link = await linksRepository.findRedirectTarget(pool, code);
    } catch (error) {
      throw new RedirectUnavailableError('database', error);
    }

    if (!link) return { outcome: 'missing' };

    const status = effectiveStatus({
      adminBlockedAt: link.admin_blocked_at,
      ownerStatus: link.owner_status,
      ownerDisabledAt: link.owner_disabled_at,
      expiresAt: link.expires_at,
    }, link.checked_at);

    if (status !== 'active') return { outcome: 'inactive' };

    return { outcome: 'redirect', destination: link.destination_url };
  }

  return { resolve };
}
