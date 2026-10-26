// DEVELOPMENT TOOL — manual check of a real Google sign-in before the Angular UI exists (T15).
// Not part of the application. Serves one page on http://localhost:4200 (an authorised origin of
// the Google client) and forwards /api/* to the API on :3000, the way Angular's dev server
// will, so cookies and the Origin check behave as in the real UI.
//
//   node --env-file=../../.env scripts/google-signin-check.mjs     (from apps/server)
//
// Then open http://localhost:4200 and sign in with a Google test user.

import { createServer, request } from 'node:http';

const PORT = 4200;
const API = { host: '127.0.0.1', port: Number(process.env.API_PORT ?? 3000) };
const clientId = process.env.GOOGLE_CLIENT_ID;

if (!clientId) {
  console.error('GOOGLE_CLIENT_ID is not set (run with --env-file=../../.env)');
  process.exit(1);
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Shortlist — Google sign-in check (development only)</title>
  <script src="https://accounts.google.com/gsi/client" async></script>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; }
    pre { background: #f3f5f4; padding: 12px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; }
    .note { color: #5f7075; }
  </style>
</head>
<body>
  <h1>Google sign-in check</h1>
  <p class="note">Development tool, not the Shortlist UI. Signs in through the real API on :3000.</p>
  <div id="button"></div>
  <h2>Steps</h2>
  <pre id="log">Preparing…</pre>
  <script>
    const log = (line) => { document.getElementById('log').textContent += '\\n' + line; };
    let csrfToken;

    async function api(path, body) {
      const options = body === undefined
        ? { credentials: 'same-origin' }
        : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) };
      const response = await fetch(path, options);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    async function main() {
      csrfToken = (await api('/api/v1/auth/csrf')).body.csrfToken;
      log('1. CSRF token received (anonymous session cookie set)');

      const attempt = await api('/api/v1/auth/google/start', { purpose: 'login' });
      log('2. Attempt started: HTTP ' + attempt.status);

      google.accounts.id.initialize({
        client_id: ${JSON.stringify(clientId)},
        nonce: attempt.body.nonce,
        callback: async ({ credential }) => {
          log('3. Google returned a signed ID token (' + credential.length + ' characters; not shown)');
          const result = await api('/api/v1/auth/google', { attemptId: attempt.body.attemptId, credential });
          log('4. POST /api/v1/auth/google → HTTP ' + result.status + '\\n' + JSON.stringify(result.body?.user ?? result.body, null, 2));
          if (result.status === 200) {
            const me = await api('/api/v1/auth/me');
            log('5. GET /api/v1/auth/me → HTTP ' + me.status + ' (' + (me.body?.user?.email ?? 'no user') + ')');
          }
        },
      });

      google.accounts.id.renderButton(document.getElementById('button'), { theme: 'outline', size: 'large', text: 'signin_with' });
      log('Ready: click "Sign in with Google".');
    }

    window.addEventListener('load', () => main().catch((error) => log('Error: ' + error.message)));
  </script>
</body>
</html>`;

function proxy(req, res) {
  const upstream = request({ ...API, path: req.url, method: req.method, headers: req.headers }, (apiResponse) => {
    res.writeHead(apiResponse.statusCode, apiResponse.headers);
    apiResponse.pipe(res);
  });

  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('API not reachable on :3000. Is the Docker stack running?');
  });

  req.pipe(upstream);
}

createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Google sign-in check: open http://localhost:${PORT}`);
});
