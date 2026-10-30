import { ALIAS_PATTERN, ERROR_CODES } from '@shortlist/contracts';

import { AppError, notFoundError, validationError } from '../../errors.js';
import { withTransaction } from '../../infra/postgres.js';
import { createCursorCodec } from '../links/rules/cursor.js';

import * as repository from './moderation.repository.js';
import { toAdminLink, toAdminReport, toAuditEntry } from './moderation.presenter.js';

// Administration (api-contracts.md, "Reports and moderation"; technical-design §6).
//
//   * Every change and its audit entry commit in one transaction: there is never a change
//     without a record, or a record of a change that did not happen.
//   * Resolving a report and blocking its link are separate, explicit actions.
//   * Link blocks use the link's version (If-Match), like owner edits, so neither side can
//     silently overwrite the other. Owners can never clear a block.
//   * Account changes are serialised; an admin cannot suspend themself, and the last active
//     admin can never be suspended. Suspension takes effect on the account's next request and
//     on every redirect of its links (both check the users row).
//
// Roles, recent authentication and CSRF are enforced by the routes; this service trusts that
// `actorId` is an active admin.

// Malformed ids can never exist; they are answered 404 without reaching PostgreSQL.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const staleLinkError = () => new AppError(412, ERROR_CODES.PRECONDITION_FAILED, 'This link was changed elsewhere. Reload it and try again.');

export function createModerationService({ pool, publicBaseUrl, cursorSecret, logger }) {
  const reportCursors = createCursorCodec(cursorSecret, 'admin-reports-cursor-v1');
  const auditCursors = createCursorCodec(cursorSecret, 'admin-audit-cursor-v1');

  function decodeCursor(codec, cursor, scope) {
    if (cursor === undefined) return null;

    const after = codec.decode(cursor, { ownerId: scope });

    if (!after) throw validationError([{ path: 'cursor', message: 'This page link is no longer valid. Start from the first page.' }]);

    return after;
  }

  // Fetches one extra row to know whether another page exists.
  function paginate(rows, limit, codec, scope, present) {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = rows.length > limit && last ? codec.encode({ ownerId: scope, createdAt: last.created_at_cursor, id: last.id }) : null;

    return { items: items.map(present), nextCursor };
  }

  async function listReports({ status, cursor, limit }) {
    const scope = `reports:${status}`;
    const after = decodeCursor(reportCursors, cursor, scope);
    const rows = await repository.listReports(pool, { status, after, limit: limit + 1 });

    return paginate(rows, limit, reportCursors, scope, toAdminReport);
  }

  async function updateReport({ id, status, note, actorId, requestId }) {
    if (!UUID.test(id)) throw notFoundError();

    return withTransaction(pool, async (client) => {
      const report = await repository.updateReportStatus(client, { id, status, actorId });

      if (!report) throw notFoundError();

      await repository.insertAudit(client, { actorId, action: `report.${status}`, targetType: 'report', targetId: id, reason: note, requestId });

      return toAdminReport(report);
    }, { logger });
  }

  async function inspectLink(code) {
    const row = ALIAS_PATTERN.test(code) ? await repository.findLinkByCode(pool, code) : null;

    if (!row) throw notFoundError();

    return toAdminLink(row, { publicBaseUrl, now: new Date() });
  }

  async function moderateLink({ id, expectedVersion, blocked, reason, actorId, requestId }) {
    if (!UUID.test(id)) throw notFoundError();

    const link = await withTransaction(pool, async (client) => {
      const changed = await repository.setLinkBlock(client, { id, expectedVersion, blocked, reason });

      if (!changed) throw (await repository.linkExists(client, id)) ? staleLinkError() : notFoundError();

      await repository.insertAudit(client, {
        actorId,
        action: blocked ? 'link.blocked' : 'link.unblocked',
        targetType: 'link',
        targetId: id,
        reason,
        requestId,
      });

      return repository.findLinkById(client, id);
    }, { logger });

    logger?.info({ linkId: id, blocked }, 'link moderated');

    return toAdminLink(link, { publicBaseUrl, now: new Date() });
  }

  async function moderateUser({ id, suspended, reason, actorId, requestId }) {
    if (!UUID.test(id)) throw notFoundError();

    if (id === actorId) {
      throw new AppError(409, ERROR_CODES.SELF_MODERATION, 'You cannot change the status of your own account.');
    }

    const status = suspended ? 'suspended' : 'active';

    const user = await withTransaction(pool, async (client) => {
      await repository.lockAccountStatusChanges(client);

      const target = await repository.findUserForUpdate(client, id);

      if (!target) throw notFoundError();

      // Already in that state: nothing changes, so nothing is recorded.
      if (target.status === status) return target;

      if (suspended && target.role === 'admin' && (await repository.countActiveAdminsExcept(client, id)) === 0) {
        throw new AppError(409, ERROR_CODES.LAST_ACTIVE_ADMIN, 'This is the last active administrator.');
      }

      const updated = await repository.setUserStatus(client, { id, status });

      await repository.insertAudit(client, {
        actorId,
        action: suspended ? 'user.suspended' : 'user.reactivated',
        targetType: 'user',
        targetId: id,
        reason,
        requestId,
      });

      return updated;
    }, { logger });

    logger?.info({ userId: id, status: user.status }, 'account moderated');

    return { id: user.id, email: user.email, role: user.role, status: user.status };
  }

  async function listAudit({ targetType, targetId, cursor, limit }) {
    const scope = targetType ? `audit:${targetType}:${targetId}` : 'audit:all';
    const after = decodeCursor(auditCursors, cursor, scope);
    const rows = await repository.listAudit(pool, { targetType, targetId, after, limit: limit + 1 });

    return paginate(rows, limit, auditCursors, scope, toAuditEntry);
  }

  return { listReports, updateReport, inspectLink, moderateLink, moderateUser, listAudit };
}
