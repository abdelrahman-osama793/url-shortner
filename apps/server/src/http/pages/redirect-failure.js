import { ALIAS_PATTERN } from '@shortlist/contracts';

// The page a person sees when a short link cannot take them anywhere (api-contracts.md,
// "Redirect contract"; UI_HANDOFF "Inactive/missing link"). Served by the API itself, so normal
// redirects never wait for Angular, and kept tiny: no scripts, no fonts, no external requests.
//
// It never says why a link is inactive, who owns it or where it pointed: blocked, disabled,
// expired and suspended links all get the same page.

const PAGES = {
  missing: {
    title: "This short link doesn't exist",
    body: 'Check that you copied the whole link. Short links are case-sensitive, so <code>Abc</code> and <code>abc</code> are different.',
    report: false,
  },
  inactive: {
    title: 'This link is no longer available',
    body: "It may have expired or been turned off. We can't tell you where it used to point.",
    report: true,
  },
  limited: {
    title: 'Too many requests',
    body: 'This network has opened a lot of links in a short time. Please wait a little and try again.',
    report: false,
  },
  unavailable: {
    title: 'Shortlist is briefly unavailable',
    body: 'Nothing is wrong with the link. Please try again in a moment.',
    report: true,
    retry: true,
  },
};

const KIND_BY_STATUS = { 400: 'missing', 404: 'missing', 410: 'inactive', 429: 'limited', 500: 'unavailable', 503: 'unavailable' };

// Response headers for the page: no scripts at all, styles only from the page itself, never
// framed, and the short link is not passed on as a referrer.
export const PAGE_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
});

export function hasFailurePage(status) {
  return status in KIND_BY_STATUS;
}

// The code from a /r/{code} path when it could be a real code, otherwise null. Only such codes
// are echoed (they contain no characters that need escaping) or passed to the report form.
export function codeFromPath(path) {
  const match = /^\/r\/([^/]+)$/.exec(path);

  if (!match) return null;

  try {
    const code = decodeURIComponent(match[1]);

    return ALIAS_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function renderRedirectFailure(status, code) {
  const page = PAGES[KIND_BY_STATUS[status]];
  const reportHref = code ? `/report?code=${encodeURIComponent(code)}` : '/report';

  const actions = [
    page.retry && code ? `<a class="primary" href="/r/${encodeURIComponent(code)}">Try again</a>` : null,
    `<a class="${page.retry && code ? 'secondary' : 'primary'}" href="/">Go to Shortlist</a>`,
    page.report ? `<a class="secondary" href="${reportHref}">Report this link</a>` : null,
  ].filter(Boolean).join('\n        ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <title>${page.title} · Shortlist</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      color-scheme: light dark;
      --page: light-dark(#f6f7f6, #141b1d);
      --paper: light-dark(#fff, #1e282b);
      --ink: light-dark(#172e34, #e9eeec);
      --muted: light-dark(#5f7075, #a8b7bb);
      --line: light-dark(#dce4e3, #38484b);
      --accent: light-dark(#24594d, #b2d6c7);
      --night: #183b3e;
      --lime: #e8efab;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 24px 16px;
      background: var(--page);
      color: var(--ink);
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    main {
      width: 100%;
      max-width: 460px;
      padding: 32px 28px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--paper);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-height: 44px;
      margin-bottom: 18px;
      color: var(--ink);
      font-weight: 800;
      font-size: 19px;
      letter-spacing: -0.6px;
      text-decoration: none;
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: var(--night);
      color: var(--lime);
      transform: rotate(-8deg);
    }
    .mark svg { transform: rotate(8deg); }
    h1 { margin: 0 0 10px; font-size: 26px; line-height: 1.25; letter-spacing: -0.6px; }
    p { margin: 0; color: var(--muted); }
    .code { margin-top: 14px; font-size: 14px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; color: var(--ink); overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
    .actions a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
    }
    .primary { background: var(--night); color: #fff; }
    .secondary { border: 1px solid var(--line); color: var(--ink); }
    a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
    @media (max-width: 400px) {
      main { padding: 26px 20px; }
      .actions a { flex: 1 1 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/" aria-label="Shortlist home"><span class="mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg></span>shortlist</a>
    <h1>${page.title}</h1>
    <p>${page.body}</p>
    ${code ? `<p class="code">Short link: <code>/r/${code}</code></p>` : ''}
    <nav class="actions" aria-label="What next">
        ${actions}
    </nav>
  </main>
</body>
</html>
`;
}
