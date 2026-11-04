// Support messages: public submission and the admin inbox.

const ACCEPTED = Object.freeze({ status: 'accepted' });

export function createSupportController({ supportService }) {
  async function submit(req, res) {
    await supportService.submit({ ...req.body, userId: req.session?.userId ?? null });

    res.status(202).json(ACCEPTED);
  }

  async function list(req, res) {
    res.json(await supportService.list(req.validatedQuery));
  }

  async function setStatus(req, res) {
    res.json(await supportService.setStatus({ id: req.params.id, status: req.body.status, actorId: req.user.id }));
  }

  return { submit, list, setStatus };
}
