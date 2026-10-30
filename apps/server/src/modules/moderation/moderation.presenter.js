import { shortUrlFor } from '../links/links.presenter.js';
import { effectiveStatus } from '../links/rules/status.js';

// Database rows → admin API shapes (@shortlist/contracts, admin.js). Admin-only fields such as
// block reasons and reporter ids appear here and nowhere in owner or public responses.

const isoOrNull = (date) => (date ? date.toISOString() : null);

export function toAdminReport(row) {
  return {
    id: row.id,
    linkId: row.link_id,
    code: row.code,
    category: row.category,
    details: row.details,
    status: row.status,
    reporterId: row.reporter_id,
    createdAt: row.created_at.toISOString(),
    resolvedAt: isoOrNull(row.resolved_at),
    resolvedBy: row.resolved_by,
  };
}

export function toAdminLink(row, { publicBaseUrl, now }) {
  return {
    id: row.id,
    code: row.code,
    shortUrl: shortUrlFor(publicBaseUrl, row.code),
    destinationUrl: row.destination_url,
    ownerId: row.owner_id,
    ownerStatus: row.owner_status ?? null,
    enabled: row.owner_disabled_at === null,
    expiresAt: isoOrNull(row.expires_at),
    blockedAt: isoOrNull(row.admin_blocked_at),
    blockReason: row.admin_block_reason,
    effectiveStatus: effectiveStatus({
      adminBlockedAt: row.admin_blocked_at,
      ownerStatus: row.owner_status,
      ownerDisabledAt: row.owner_disabled_at,
      expiresAt: row.expires_at,
    }, now),
    openReports: row.open_reports,
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

export function toAuditEntry(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: row.created_at.toISOString(),
  };
}
