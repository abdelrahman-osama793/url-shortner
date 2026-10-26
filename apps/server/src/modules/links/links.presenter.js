import { effectiveStatus } from './rules/status.js';

// Converts database rows into the API shapes defined in @shortlist/contracts.
// Admin block reasons and owner IDs are never included.

export function shortUrlFor(publicBaseUrl, code) {
  return `${publicBaseUrl}/r/${encodeURIComponent(code)}`;
}

function isoOrNull(date) {
  return date ? date.toISOString() : null;
}

// Full management view for the link's owner.
export function toLinkResource(row, { publicBaseUrl, now }) {
  return {
    id: row.id,
    code: row.code,
    shortUrl: shortUrlFor(publicBaseUrl, row.code),
    destinationUrl: row.destination_url,
    expiresAt: isoOrNull(row.expires_at),
    enabled: row.owner_disabled_at === null,
    effectiveStatus: effectiveStatus({
      adminBlockedAt: row.admin_blocked_at,
      ownerStatus: row.owner_status,
      ownerDisabledAt: row.owner_disabled_at,
      expiresAt: row.expires_at,
    }, now),
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

// Guests get only what they need to share the link: no id, no management fields.
export function toGuestLinkResource(row, { publicBaseUrl }) {
  return {
    code: row.code,
    shortUrl: shortUrlFor(publicBaseUrl, row.code),
    expiresAt: row.expires_at.toISOString(),
  };
}
