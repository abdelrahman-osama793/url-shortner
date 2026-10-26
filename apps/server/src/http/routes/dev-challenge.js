import { Router } from 'express';
import { z } from 'zod';

import { validateBody } from '../middleware/validate.js';

const IssueRequestSchema = z.strictObject({
  action: z.string().min(1).max(64),
});

// DEVELOPMENT ONLY. Stands in for a real challenge widget by issuing a signed token for an
// action. api.js mounts it only when CHALLENGE_PROVIDER=dev, which config.js refuses in
// production. It is mock behaviour, not a working human-verification integration.
export function createDevChallengeRouter({ verifier }) {
  const router = Router();

  router.post('/api/v1/dev/challenge-token', validateBody(IssueRequestSchema), (req, res) => {
    res.status(201).json({ challengeToken: verifier.issue(req.body.action) });
  });

  return router;
}
