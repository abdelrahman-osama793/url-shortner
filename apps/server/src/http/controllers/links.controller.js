// Link endpoints: read the validated request, call the link service, send the result.
export function createLinksController({ linkService }) {
  // 201 with { code, shortUrl, expiresAt } only: no id, Location or ETag, so guests get no
  // handle to manage the link (decision D04).
  async function createGuestLink(req, res) {
    const link = await linkService.createGuestLink({ destinationUrl: req.body.destinationUrl });

    res.status(201).json(link);
  }

  return { createGuestLink };
}
