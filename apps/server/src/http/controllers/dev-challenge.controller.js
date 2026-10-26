// DEVELOPMENT ONLY. Stands in for a real challenge widget by issuing a signed token for an
// action. Mock behaviour, not a working human-verification integration.
export function createDevChallengeController({ verifier }) {
  function issueToken(req, res) {
    res.status(201).json({ challengeToken: verifier.issue(req.body.action) });
  }

  return { issueToken };
}
