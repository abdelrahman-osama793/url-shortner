import { randomUUID } from 'node:crypto';

// Gives every request a server-generated ID, returned in X-Request-Id and in error bodies,
// so a user-reported error can be matched to its log line.
// Incoming X-Request-Id headers are ignored: clients must not be able to inject log values.
export function requestId() {
  return (req, res, next) => {
    req.id = `req_${randomUUID()}`;

    res.set('X-Request-Id', req.id);

    next();
  };
}
