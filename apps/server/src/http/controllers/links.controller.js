import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';

// Link endpoints: read the validated request, call the link service, send the result.
// Owned links carry their version as a strong ETag ("v3"); edits must send it back in If-Match.

const etagOf = (link) => `"v${link.version}"`;

// Returns the version number from `If-Match: "v3"`, or throws 428 when it is missing or malformed.
function expectedVersion(req) {
  const match = /^"v([1-9][0-9]{0,9})"$/.exec(req.get('If-Match') ?? '');

  if (!match) {
    throw new AppError(428, ERROR_CODES.PRECONDITION_REQUIRED, 'Send the If-Match header with the version you are editing.');
  }

  return Number(match[1]);
}

export function createLinksController({ linkService }) {
  // 201 with { code, shortUrl, expiresAt } only: no id, Location or ETag, so guests get no
  // handle to manage the link (decision D04).
  async function createGuestLink(req, res) {
    const link = await linkService.createGuestLink({ destinationUrl: req.body.destinationUrl });

    res.status(201).json(link);
  }

  async function createOwnedLink(req, res) {
    const link = await linkService.createOwnedLink({ ownerId: req.user.id, ...req.body });

    res.status(201).location(`/api/v1/links/${link.id}`).set('ETag', etagOf(link)).json(link);
  }

  async function listOwnedLinks(req, res) {
    const page = await linkService.listOwnedLinks({ ownerId: req.user.id, ...req.validatedQuery });

    res.json(page);
  }

  async function getOwnedLink(req, res) {
    const link = await linkService.getOwnedLink({ ownerId: req.user.id, id: req.params.id });

    res.set('ETag', etagOf(link)).json(link);
  }

  // The response is sent only after the update committed, so a redirect requested after it
  // already uses the new state (decision D12).
  async function updateOwnedLink(req, res) {
    const link = await linkService.updateOwnedLink({
      ownerId: req.user.id,
      id: req.params.id,
      expectedVersion: expectedVersion(req),
      changes: req.body,
    });

    res.set('ETag', etagOf(link)).json(link);
  }

  return { createGuestLink, createOwnedLink, listOwnedLinks, getOwnedLink, updateOwnedLink };
}
