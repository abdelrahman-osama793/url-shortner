import { randomUUID } from 'node:crypto';

// Express 5 forwards both thrown errors and rejected promises from route handlers
// to the error middleware below, so handlers do not need their own try/catch.
// Responses use the documented error envelope and never include stack traces.

function sendError(res, status, code, message) {
  const requestId = `req_${randomUUID()}`;

  res.status(status);
  res.set('Cache-Control', 'no-store');
  res.json({ error: { code, message, requestId } });

  return requestId;
}

export function notFoundHandler(_req, res) {
  sendError(res, 404, 'NOT_FOUND', 'The requested resource does not exist.');
}

// Express identifies error middleware by its four parameters, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, next) {
  const requestId = sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');

  console.error(`request ${requestId} failed`, error);
}
