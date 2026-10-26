// Tests deliver email to the development mail catcher (Mailpit) over real SMTP and read it
// back through Mailpit's HTTP API. Settings come from TEST_SMTP_URL / TEST_MAILPIT_URL (CI)
// or the host ports in .env.

export function testSmtpUrl(env = process.env) {
  return env.TEST_SMTP_URL ?? `smtp://localhost:${env.MAILPIT_SMTP_PORT ?? '1025'}`;
}

function mailpitUrl(env = process.env) {
  return env.TEST_MAILPIT_URL ?? `http://localhost:${env.MAILPIT_UI_PORT ?? '8025'}`;
}

// Unique per test, so messages from different tests and runs never mix.
export function uniqueAddress() {
  return `test-${crypto.randomUUID()}@example.com`;
}

// Returns the full messages (with Text) sent to `address`.
export async function messagesTo(address) {
  const search = await fetch(`${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);

  if (!search.ok) throw new Error(`Mailpit search failed: ${search.status}`);

  const { messages } = await search.json();

  return Promise.all(messages.map(async ({ ID }) => (await fetch(`${mailpitUrl()}/api/v1/message/${ID}`)).json()));
}

// Extracts the one-time token from an email's #token=… link.
export function tokenFromEmail(message) {
  return decodeURIComponent(message.Text.match(/#token=([^\s]+)/)[1]);
}
