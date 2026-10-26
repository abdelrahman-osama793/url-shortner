import pino from 'pino';

// Field names whose values must never reach logs, wherever they appear.
// Wildcards cover objects nested up to two levels (e.g. { body: { password } }).
const SECRET_KEYS = [
  'password',
  'newPassword',
  'passwordHash',
  'token',
  'credential',
  'challengeToken',
  'csrfToken',
  'cookie',
  'authorization',
  'set-cookie',
  'x-csrf-token',
  'databaseUrl',
  'connectionString',
];

const REDACT_PATHS = SECRET_KEYS.flatMap((key) => {
  const property = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
  const join = (prefix) => (property.startsWith('[') ? `${prefix}${property}` : `${prefix}.${property}`);

  return [property, join('*'), join('*.*')];
});

// Credentials inside connection strings, e.g. postgres://user:secret@host/db.
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]*:)[^@\s/]+@/gi;

function scrubUrlCredentials(text) {
  return text.replace(URL_CREDENTIALS, '$1[REDACTED]@');
}

// Errors are logged with type, message and stack only. Arbitrary error properties are
// dropped because libraries sometimes attach request configs or connection details.
function serializeError(error) {
  if (!(error instanceof Error)) return error;

  return {
    type: error.name,
    message: scrubUrlCredentials(error.message),
    code: error.code,
    stack: error.stack && scrubUrlCredentials(error.stack),
    cause: error.cause ? serializeError(error.cause) : undefined,
  };
}

// `destination` is injectable so tests can capture output; production writes to stdout.
export function createLogger({ level = 'info', destination } = {}) {
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { err: serializeError, error: serializeError },
    },
    destination,
  );
}
