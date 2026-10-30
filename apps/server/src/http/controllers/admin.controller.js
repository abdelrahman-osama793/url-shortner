import { etagOf, expectedVersion } from '../versions.js';

// Administration endpoints: read the validated request, call the moderation service, send the
// result. Every change passes the acting admin and the request id, which the audit entry keeps.

export function createAdminController({ moderationService }) {
  const actor = (req) => ({ actorId: req.user.id, requestId: req.id });

  async function listReports(req, res) {
    res.json(await moderationService.listReports(req.validatedQuery));
  }

  async function updateReport(req, res) {
    res.json(await moderationService.updateReport({ id: req.params.id, ...req.body, ...actor(req) }));
  }

  async function inspectLink(req, res) {
    const link = await moderationService.inspectLink(req.validatedQuery.code);

    res.set('ETag', etagOf(link)).json(link);
  }

  async function moderateLink(req, res) {
    const link = await moderationService.moderateLink({ id: req.params.id, expectedVersion: expectedVersion(req), ...req.body, ...actor(req) });

    res.set('ETag', etagOf(link)).json(link);
  }

  async function moderateUser(req, res) {
    res.json(await moderationService.moderateUser({ id: req.params.id, ...req.body, ...actor(req) }));
  }

  async function listAudit(req, res) {
    res.json(await moderationService.listAudit(req.validatedQuery));
  }

  return { listReports, updateReport, inspectLink, moderateLink, moderateUser, listAudit };
}
