// T33 journey 1: a guest shortens links on the home page.
// Run with the Playwright MCP tool (browser_run_code_unsafe, filename=this file) against the
// local stack (ng serve on :4200, Docker API on :3000). Guest rate limits must be fresh.
// Returns a list of [check, result] pairs; any thrown error fails the journey.
async (page) => {
  const base = 'http://localhost:4200';
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push([name, ok ? 'pass' : `FAIL ${detail}`]);
  };

  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const p = await context.newPage();

  try {
    await p.goto(base);
    check('home shows Log in and Sign up', (await p.getByRole('link', { name: 'Log in' }).count()) > 0 && (await p.getByRole('link', { name: /Sign up/ }).count()) > 0);

    // Empty input never reaches the server (and counts toward nothing).
    await p.getByRole('button', { name: /Shorten link/ }).click();
    check('empty submit explains what to do', await p.getByText('Paste the link you want to shorten.').waitFor({ timeout: 3000 }).then(() => true, () => false));

    const shorten = async (url) => {
      await p.locator('#destination').fill(url);
      await p.getByRole('button', { name: /Shorten link/ }).click();
    };
    const verifyIfAsked = async () => {
      const asked = await p.getByText('Quick check').waitFor({ timeout: 4000 }).then(() => true, () => false);

      if (asked) await p.getByRole('button', { name: 'Complete verification' }).click();

      return asked;
    };

    const focusIs = (id) => p.waitForFunction((target) => document.activeElement?.id === target, id, { timeout: 2000 }).then(() => true, () => false);

    // Attempt 1 (invalid URL): a field error. Every attempt counts toward the hourly quota (5) and
    // the suspicious-activity threshold (2 per 10 minutes), valid or not, by design.
    await shorten('not a link');
    await p.locator('#destination-error').waitFor();
    check('invalid URL is a field error with aria-invalid', (await p.locator('#destination').getAttribute('aria-invalid')) === 'true');

    // Attempt 2: created without verification.
    await shorten('https://example.com/t33-guest-1');
    await p.locator('#short-url').waitFor();
    const first = await p.locator('#short-url').inputValue();
    check('first link created without verification', true);
    check('focus moves to the new link', await focusIs('short-url'));
    check('expiry is shown', (await p.getByText(/Guest link · expires/).count()) === 1);
    await p.getByRole('button', { name: /Copy link/ }).click();
    await p.getByRole('button', { name: /Copied/ }).waitFor();
    check('copy puts the short link on the clipboard', (await p.evaluate(() => navigator.clipboard.readText())) === first);
    const followed = await p.request.get(first, { maxRedirects: 0 });
    check('the link redirects 302 to its destination', followed.status() === 302 && followed.headers().location === 'https://example.com/t33-guest-1');
    await p.getByRole('button', { name: 'Shorten another link' }).click();
    check('"Shorten another link" returns focus to the field', await focusIs('destination'));

    // Attempts 3-4: suspicious now → the development challenge (clearly labelled), then created.
    await shorten('https://example.com/t33-guest-2');
    await p.getByText('Quick check').waitFor();
    check('third attempt asks for verification', true);
    check('verification is labelled as a development mock', (await p.getByText('Development mock: no real human verification takes place.').count()) === 1);
    check('focus moves to the verification button', await p.waitForFunction(() => document.activeElement?.textContent?.includes('Complete verification'), null, { timeout: 2000 }).then(() => true, () => false));
    await p.getByRole('button', { name: 'Complete verification' }).click();
    await p.locator('#short-url').waitFor();
    const second = await p.locator('#short-url').inputValue();
    check('after verification the link is created and redirects', (await p.request.get(second, { maxRedirects: 0 })).status() === 302);
    await p.getByRole('button', { name: 'Shorten another link' }).click();

    // Attempts 5-6: challenged again; the verified retry is the sixth attempt and exceeds the
    // hourly quota, so it is refused with the wait time and the typed link is kept.
    await shorten('https://example.com/t33-guest-3');
    check('fourth link asks for verification again', await verifyIfAsked());
    const limited = await p.getByText(/try again in about/).waitFor({ timeout: 5000 }).then(() => true, () => false);
    check('the attempt over the hourly quota is refused with a wait time', limited);
    check('the typed link is kept after the refusal', (await p.locator('#destination').inputValue()) === 'https://example.com/t33-guest-3');
  } catch (error) {
    // Keep the evidence gathered so far, and say where it stopped.
    const shown = (await p.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);

    results.push(['journey stopped', `FAIL ${String(error.message).split('\n')[0]} (after: ${results.at(-1)?.[0] ?? 'start'}) page: ${shown}`]);
    await p.screenshot({ path: '.playwright-mcp/t33-j1-failure.png', fullPage: true }).catch(() => null);
  } finally {
    await context.close();
  }

  return results;
}
