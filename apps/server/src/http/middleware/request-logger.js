// Logs one line per finished request.
// Deliberately omitted: query strings, request bodies, headers and client IP addresses.
// Those can carry tokens or personal data (database-schema.md, analytics privacy rules).
export function requestLogger(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      logger.info({
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      }, 'request finished');
    });

    next();
  };
}
