import { SESSION_COOKIE } from '../../src/http/middleware/session.js';

import { ALLOWED_ORIGIN } from './http.js';

// Every simulated browser gets its own client address unless one is given, so rate-limit
// counters never leak between tests.
let nextHost = 1;

export function uniqueClientIp() {
  nextHost += 1;

  return `203.0.${Math.floor(nextHost / 250)}.${(nextHost % 250) + 1}`;
}

// A browser: keeps its session cookie and CSRF token across requests, like a real one would,
// including when sign-in replaces the session.
export async function newBrowser(server, clientIp = uniqueClientIp()) {
  const browser = { clientIp, cookie: null, csrfToken: null };

  function rememberCookie(response) {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];

      if (pair.startsWith(`${SESSION_COOKIE}=`)) {
        browser.cookie = pair.endsWith('=') ? null : pair;
      }
    }
  }

  browser.headers = (extra = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, 'X-Forwarded-For': clientIp };

    if (browser.cookie) headers.Cookie = browser.cookie;
    if (browser.csrfToken) headers['X-CSRF-Token'] = browser.csrfToken;

    return { ...headers, ...extra };
  };

  browser.request = async (path, { method = 'GET', body, headers } = {}) => {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: browser.headers(headers),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    rememberCookie(response);

    return response;
  };

  browser.post = (path, body, headers) => browser.request(path, { method: 'POST', body, headers });

  const csrf = await browser.request('/api/v1/auth/csrf');

  browser.csrfToken = (await csrf.json()).csrfToken;

  return browser;
}
