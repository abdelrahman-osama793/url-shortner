import { Router } from 'express';
import { z } from 'zod';

import { validateBody } from '../middleware/validate.js';

const IssueRequestSchema = z.strictObject({
  action: z.string().min(1).max(64),
});

// POST /api/v1/dev/challenge-token. api.js mounts this only when CHALLENGE_PROVIDER=dev,
// which config.js refuses in production.
export function createDevChallengeRouter({ controller }) {
  const router = Router();

  router.post('/api/v1/dev/challenge-token', validateBody(IssueRequestSchema), controller.issueToken);

  return router;
}
