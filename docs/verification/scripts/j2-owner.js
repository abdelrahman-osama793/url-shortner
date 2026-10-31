// T33 journey 2: a new person signs up with email and manages their links.
// Run with the Playwright MCP tool (browser_run_code_unsafe, filename=this file) against the
// local stack: ng serve on :4200, Docker API + worker on :3000, Mailpit on :8025.
// Returns [check, result] pairs; the last pair says where it stopped if anything threw.
async (page) => {
  const base = 'http://localhost:4200';
  const mailpit = 'http://localhost:8025';
  const results = [];
  const check = (name, ok, detail = '') => results.push([name, ok ? 'pass' : `FAIL ${detail}`]);
  const stamp = Date.now().toString(36);
  const email = `t33-owner-${stamp}@example.test`;
  const password = `local-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  const alias = `t33-${stamp}`;

  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();

  const latestLink = async (kind) => {
    for (let i = 0; i < 30; i += 1) {
      const list = await (await p.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();

      for (const message of list.messages ?? []) {
        const text = (await (await p.request.get(`${mailpit}/api/v1/message/${message.ID}`)).json()).Text;
        const link = text.match(new RegExp(`http\\S+${kind}\\S+`))?.[0];

        if (link) return link;
      }
      await p.waitForTimeout(500);
    }

    throw new Error(`no ${kind} email for ${email}`);
  };
  const redirect = async (code) => (await p.request.get(`${base}/r/${code}`, { maxRedirects: 0 })).status();

  try {
    // Sign up → check-your-inbox
    await p.goto(`${base}/signup`);
    await p.locator('#email').fill(email);
    await p.locator('#password').fill('short');
    await p.getByRole('button', { name: 'Create account' }).click();
    check('a short password is refused before sending', await p.getByText('Use at least 12 characters.').waitFor({ timeout: 3000 }).then(() => true, () => false));
    await p.locator('#password').fill(password);
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.waitForURL('**/signup/check-email');
    check('sign-up leads to "verify your email" naming the address', (await p.getByText(email).count()) === 1);
    check('the email address is not put in the URL', !p.url().includes(encodeURIComponent(email)) && !p.url().includes(email));

    // Restricted session before verifying
    await p.goto(`${base}/login`);
    await p.locator('#email').fill(email);
    await p.locator('#password').fill(password);
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.waitForURL('**/app/links');
    check('an unverified account can log in to a restricted workspace', (await p.getByText('Verify your email to create links.').count()) === 1);
    check('creating links is disabled until verified', await p.locator('#create-link').isDisabled());

    // Verify through the emailed link (token removed from the address)
    await p.goto(await latestLink('verify-email'));
    // Angular removes it as soon as the page starts (after the lazy chunk loads).
    check('the verification token is removed from the address', await p.waitForFunction(() => !location.href.includes('token='), null, { timeout: 5000 }).then(() => true, () => false));
    await p.getByRole('button', { name: 'Confirm email address' }).click();
    await p.getByText('Email verified').waitFor();
    await p.getByRole('link', { name: /Go to your links/ }).click();
    await p.waitForURL('**/app/links');
    await p.getByText('No links yet').waitFor();
    check('after verification the banner is gone and the empty state shows', (await p.getByText('Verify your email to create links.').count()) === 0);

    // Create with alias and expiry
    await p.getByRole('button', { name: 'Create link' }).click();
    await p.locator('#destination').fill('https://example.com/t33-owner-original');
    await p.locator('#alias').fill(alias);
    const inMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await p.locator('#expiry').fill(inMonth);
    await p.locator('app-link-editor').getByRole('button', { name: 'Create link' }).click();
    await p.getByText(`/r/${alias}`).first().waitFor();
    check('link with alias and expiry is created', (await p.locator('li').first().innerText()).includes('Expires'));
    check('the alias redirects 302', (await redirect(alias)) === 302);

    // Taken alias keeps the input
    await p.getByRole('button', { name: 'Create link' }).click();
    await p.locator('#destination').fill('https://example.com/other');
    await p.locator('#alias').fill(alias);
    await p.locator('app-link-editor').getByRole('button', { name: 'Create link' }).click();
    await p.getByText('That alias is taken or reserved').waitFor();
    check('a taken alias is a field error and the input is kept', (await p.locator('#alias').inputValue()) === alias);
    await p.getByRole('button', { name: 'Close link editor' }).click();

    // Edit the destination; the next request follows the new one
    await p.getByRole('button', { name: 'Edit' }).first().click();
    await p.locator('#destination').fill('https://example.com/t33-owner-updated');
    await p.getByRole('button', { name: 'Save changes' }).click();
    await p.getByText('https://example.com/t33-owner-updated').first().waitFor();
    const afterEdit = await p.request.get(`${base}/r/${alias}`, { maxRedirects: 0 });
    check('an edit applies to the very next redirect', afterEdit.headers().location === 'https://example.com/t33-owner-updated');

    // Disable → visitors get the inactive page; enable → works again
    await p.getByRole('button', { name: 'Disable' }).click();
    await p.getByRole('button', { name: 'Enable' }).waitFor();
    check('disabled link answers 410', (await redirect(alias)) === 410);
    const visitor = await context.newPage();
    await visitor.goto(`${base}/r/${alias}`);
    check('a visitor sees the inactive page, not the destination', (await visitor.locator('h1').innerText()) === 'This link is no longer available' && !(await visitor.content()).includes('t33-owner-updated'));
    await visitor.close();
    await p.getByRole('button', { name: 'Enable' }).click();
    await p.getByRole('button', { name: 'Disable' }).waitFor();
    check('enabled link redirects again', (await redirect(alias)) === 302);

    // Real clicks reach analytics through the worker
    for (let i = 0; i < 4; i += 1) await p.request.get(`${base}/r/${alias}`, { maxRedirects: 0, headers: { Referer: 'https://news.example/item' } });
    await p.getByRole('link', { name: 'Analytics' }).nth(1).click();
    await p.waitForURL('**/app/analytics?link=*');
    const counted = await p.waitForFunction(() => Number(document.querySelector('.total')?.textContent?.replace(/\D/g, '')) >= 5, null, { timeout: 25000 }).then(() => true, () => false);
    check('clicks appear in analytics within one refresh (≤ 25 s)', counted);
    check('referring site is reported', (await p.getByText('news.example').count()) > 0);
    check('counts are described honestly (not unique visitors)', (await p.getByText(/not unique visitors/).count()) === 1);

    // Account: methods, reset link by email, log out
    await p.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Account' }).click();
    await p.getByText('Sign-in methods').first().waitFor();
    check('account shows a verified email and the password method', (await p.getByText('Verified').count()) > 0 && (await p.getByRole('button', { name: 'Email me a reset link' }).count()) === 1);
    await p.getByRole('button', { name: 'Email me a reset link' }).click();
    await p.getByText('Check your inbox for the reset link').waitFor();
    check('a reset email is sent to the account address', (await latestLink('reset-password')).includes('#token='));
    await p.getByRole('button', { name: /Log out/ }).first().click();
    await p.waitForURL(`${base}/`);
    await p.goto(`${base}/app/links`);
    await p.waitForURL('**/login?next=*');
    check('after log out the workspace asks to log in', true);
  } catch (error) {
    const shown = (await p.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);

    results.push(['journey stopped', `FAIL ${String(error.message).split('\n')[0]} (after: ${results.at(-1)?.[0] ?? 'start'}) page: ${shown}`]);
    await p.screenshot({ path: '.playwright-mcp/t33-j2-failure.png', fullPage: true }).catch(() => null);
  } finally {
    await context.close();
  }

  return { email, alias, results };
}
