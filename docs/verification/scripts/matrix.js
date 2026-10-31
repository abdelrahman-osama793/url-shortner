// T33 visual and accessibility matrix. Visits each screen in light and dark at 320, 768 and
// 1280 px, runs the in-page checks below on every state, saves a screenshot per state, then
// repeats the screens on an emulated touch phone (coarse pointer, 390 px) and with reduced motion.
// Run with the Playwright MCP tool (browser_run_code_unsafe) against the local stack. The
// workspace screens need a local admin account: replace __ADMIN_EMAIL__ / __ADMIN_PASSWORD__ in
// an uncommitted copy.
async (page) => {
  const base = 'http://localhost:4200';
  const admin = { email: '__ADMIN_EMAIL__', password: '__ADMIN_PASSWORD__' };
  const shotDir = '.playwright-mcp/t33';

  // [name, path, signed in?, optional setup run after load]
  const screens = [
    ['home', '/', false],
    ['login', '/login', false],
    ['signup', '/signup', false],
    ['check-email', '/signup/check-email', false],
    ['forgot', '/forgot-password', false],
    ['reset-invalid', '/reset-password', false],
    ['verify-invalid', '/verify-email', false],
    ['report', '/report', false],
    ['not-found', '/no-such-page', false],
    ['r-missing', '/r/NoSuchCode7', false],
    ['links', '/app/links', true],
    ['links-editor', '/app/links', true, async (p) => { await p.getByRole('button', { name: 'Create link' }).click(); }],
    ['analytics', '/app/analytics', true],
    ['account', '/app/account', true],
    ['admin', '/app/admin', true, async (p) => { await p.locator('.report-item').first().click().catch(() => null); }],
  ];

  // Runs inside the page: returns problems found in the current state.
  const inspect = () => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const bgOf = (el) => { const s = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { s.push(c); if (c.a >= 1) break; } } let b = { r: 255, g: 255, b: 255, a: 1 }; for (const c of s.reverse()) b = blend(c, b); return b; };
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], .visually-hidden, .google-slot'); };
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const problems = [];

    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) problems.push(`horizontal overflow ${overflow}px`);

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        const fg = parse(cs.color); const bg = bgOf(el);
        if (fg && bg) {
          const f = blend(fg, bg); const ratio = (Math.max(lum(f), lum(bg)) + 0.05) / (Math.min(lum(f), lum(bg)) + 0.05);
          const large = parseFloat(cs.fontSize) >= 24 || (Number(cs.fontWeight) >= 700 && parseFloat(cs.fontSize) >= 18.66);
          if (ratio < (large ? 3 : 4.5) && !el.closest('button:disabled, input:disabled')) problems.push(`contrast ${ratio.toFixed(2)} ${label(el)}`);
        }
        // Text cut off without an ellipsis or a deliberate line clamp.
        const clipped = el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp === 'none';
        if (clipped) problems.push(`clipped text ${label(el)}`);
      }
    }

    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"]')) {
      if (!visible(el)) continue;
      const field = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
      const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
      if (field && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) problems.push(`unlabelled field ${label(el)}`);
      if (!field && !name && !el.getAttribute('aria-labelledby')) problems.push(`unnamed control ${label(el)}`);
      const r = el.getBoundingClientRect();
      const inSentence = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
      if (!inSentence && el.type !== 'radio' && el.type !== 'checkbox' && (r.width < 24 || r.height < 24)) problems.push(`target ${Math.round(r.width)}x${Math.round(r.height)} ${label(el)}`);
    }

    const ids = {};
    for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] ?? 0) + 1;
    for (const [id, count] of Object.entries(ids)) if (count > 1) problems.push(`duplicate id ${id}`);

    const levels = [...document.querySelectorAll('h1, h2, h3, h4')].filter(visible).map((h) => Number(h.tagName[1]));
    if (levels[0] !== undefined && levels[0] !== 1) problems.push(`first heading is h${levels[0]}`);
    levels.forEach((level, i) => { if (i > 0 && level > levels[i - 1] + 1) problems.push(`heading skips h${levels[i - 1]}→h${level}`); });
    if (document.querySelectorAll('main').length !== 1) problems.push(`${document.querySelectorAll('main').length} main landmarks`);
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) problems.push(`img without alt ${img.src}`);

    return problems;
  };

  const browser = page.context().browser();
  const report = {};
  const settle = async (p) => { await p.waitForLoadState('networkidle').catch(() => null); await p.waitForTimeout(500); };

  const run = async (contextOptions, combos, suffix, extra) => {
    const context = await browser.newContext(contextOptions);
    const p = await context.newPage();

    await p.goto(`${base}/login`);
    await p.locator('#email').fill(admin.email);
    await p.locator('#password').fill(admin.password);
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.waitForURL('**/app/links');
    const signedIn = await context.storageState();
    const guest = await browser.newContext(contextOptions);
    const g = await guest.newPage();

    for (const [name, path, member, setup] of screens) {
      const target = member ? p : g;

      for (const { theme, width } of combos) {
        await target.setViewportSize({ width, height: width < 600 ? 800 : 900 });
        await target.emulateMedia({ colorScheme: theme, reducedMotion: extra?.reducedMotion ?? 'no-preference' });
        await target.goto(`${base}${path}`);
        await settle(target);
        if (setup) { await setup(target); await target.waitForTimeout(500); }
        const key = `${name} ${theme} ${width}${suffix}`;
        const problems = await target.evaluate(inspect);
        if (extra?.check) problems.push(...(await target.evaluate(extra.check)));
        report[key] = problems;
        if (!suffix) await target.screenshot({ path: `${shotDir}/${name}-${theme}-${width}.png`, fullPage: true });
      }
    }

    void signedIn;
    await guest.close();
    await context.close();
  };

  const combos = [];
  for (const theme of ['light', 'dark']) for (const width of [320, 768, 1280]) combos.push({ theme, width });

  // 1. Every screen, both themes, three widths.
  await run({ viewport: { width: 1280, height: 900 } }, combos, '');

  // 2. Touch phone: coarse pointer, so every control should reach about 44 px.
  await run({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, [{ theme: 'light', width: 390 }], ' touch', {
    check: () => {
      const small = [];
      for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary')) {
        const r = el.getBoundingClientRect();
        if (!r.width || el.closest('.google-slot, [aria-hidden="true"], .visually-hidden')) continue;
        const inSentence = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        if (!inSentence && el.type !== 'radio' && el.type !== 'checkbox' && r.height < 43.5) small.push(`touch target ${Math.round(r.height)}px ${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`);
      }
      return small;
    },
  });

  // 3. Reduced motion: nothing should transition or animate.
  await run({ viewport: { width: 1280, height: 900 } }, [{ theme: 'light', width: 1280 }], ' reduced-motion', {
    reducedMotion: 'reduce',
    check: () => [...document.querySelectorAll('body *')]
      .filter((el) => { const cs = getComputedStyle(el); return cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || cs.animationName !== 'none'; })
      .map((el) => `moves under reduced motion: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
  });

  return report;
}
