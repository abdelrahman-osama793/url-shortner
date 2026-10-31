// T33 journeys 4-5: a visitor reports a link; an admin resolves the report, blocks and unblocks
// the link, and suspends and reactivates its owner, who is signed out with an explanation.
// Run with the Playwright MCP tool (browser_run_code_unsafe) against the local stack. Replace
// __ADMIN_EMAIL__ / __ADMIN_PASSWORD__ with a local admin account (granted with
// src/cli/set-role.js) in an uncommitted copy; never commit real credentials.
async (page) => {
  const base = 'http://localhost:4200';
  const mailpit = 'http://localhost:8025';
  const admin = { email: '__ADMIN_EMAIL__', password: '__ADMIN_PASSWORD__' };
  const results = [];
  const check = (name, ok, detail = '') => results.push([name, ok ? 'pass' : `FAIL ${detail}`]);
  const stamp = Date.now().toString(36);
  const owner = { email: `t33-mod-${stamp}@example.test`, password: `local-mod-${stamp}-z9` };
  const alias = `t33-mod-${stamp}`;

  const browser = page.context().browser();
  const contexts = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    contexts.push(context);

    return context.newPage();
  };
  const ownerPage = await open();
  const adminPage = await open();
  const visitorPage = await open();

  const verifyLink = async () => {
    for (let i = 0; i < 30; i += 1) {
      const list = await (await ownerPage.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${owner.email}`)}`)).json();

      if (list.messages?.length) {
        return (await (await ownerPage.request.get(`${mailpit}/api/v1/message/${list.messages[0].ID}`)).json()).Text.match(/http\S+verify-email\S+/)[0];
      }
      await ownerPage.waitForTimeout(500);
    }

    throw new Error('no verification email');
  };
  const logIn = async (p, account) => {
    await p.goto(`${base}/login`);
    await p.locator('#email').fill(account.email);
    await p.locator('#password').fill(account.password);
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.waitForURL('**/app/links');
  };
  const status = async (code) => (await visitorPage.request.get(`${base}/r/${code}`, { maxRedirects: 0 })).status();
  const act = async (button, reason, confirm) => {
    await adminPage.getByRole('button', { name: button, exact: true }).click();
    await adminPage.locator('#action-reason').fill(reason);
    await adminPage.locator('app-moderation-action').getByRole('button', { name: confirm }).click();
  };

  try {
    // An owner with a link.
    await ownerPage.goto(`${base}/signup`);
    await ownerPage.locator('#email').fill(owner.email);
    await ownerPage.locator('#password').fill(owner.password);
    await ownerPage.getByRole('button', { name: 'Create account' }).click();
    await ownerPage.waitForURL('**/signup/check-email');
    await ownerPage.goto(await verifyLink());
    await ownerPage.getByRole('button', { name: 'Confirm email address' }).click();
    await ownerPage.getByText('Email verified').waitFor();
    await logIn(ownerPage, owner);
    await ownerPage.getByRole('button', { name: 'Create link' }).click();
    await ownerPage.locator('#destination').fill('https://example.com/t33-reported-destination');
    await ownerPage.locator('#alias').fill(alias);
    await ownerPage.locator('app-link-editor').getByRole('button', { name: 'Create link' }).click();
    await ownerPage.getByText(`/r/${alias}`).first().waitFor();

    // A visitor reports it from the public form (no account).
    await visitorPage.goto(`${base}/report`);
    await visitorPage.locator('#report-link').fill(`${base}/r/${alias}`);
    await visitorPage.locator('input[value="phishing"]').check();
    await visitorPage.locator('#report-details').fill('T33: asks for bank details.');
    await visitorPage.getByRole('button', { name: /Send report/ }).click();
    await visitorPage.getByText('Thanks for your report').waitFor();
    check('a visitor can report a link without an account', true);

    // Non-admins have no Administration entry and are turned away from the page.
    check('owners see no Administration link', (await ownerPage.getByRole('link', { name: 'Administration' }).count()) === 0);
    await ownerPage.goto(`${base}/app/admin`);
    check('owners opening /app/admin are sent to their links', await ownerPage.waitForURL('**/app/links', { timeout: 10000 }).then(() => true, () => false));

    // The admin finds it in the queue.
    await logIn(adminPage, admin);
    await adminPage.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Administration' }).click();
    await adminPage.getByRole('heading', { name: 'Moderation', exact: true }).waitFor();
    const item = adminPage.locator('.report-item', { hasText: `/r/${alias}` });
    await item.waitFor();
    check('the report appears in the admin queue', true);
    await item.click();
    // (The detail panel has a hidden "Details" heading even when empty, so wait for real content.)
    const loaded = await adminPage.locator('.detail').getByText('t33-reported-destination').waitFor({ timeout: 10000 }).then(() => true, () => false);
    check('the detail shows the destination and the reporter text', loaded && (await adminPage.locator('.detail').getByText('T33: asks for bank details.').count()) > 0);

    // Resolving never blocks.
    await act('Resolve', 'T33: reviewed, blocking separately.', /Save status/);
    await adminPage.getByText('The link was not changed.').waitFor();
    check('resolving the report leaves the link working (302)', (await status(alias)) === 302);

    // Block → visitors get the inactive page; the owner sees "Blocked" but not why.
    await act('Block link', 'T33: phishing confirmed (internal note).', 'Block link');
    await adminPage.getByText('Link blocked.').waitFor();
    check('blocking makes the link answer 410', (await status(alias)) === 410);
    await visitorPage.goto(`${base}/r/${alias}`);
    const page410 = await visitorPage.content();
    check('the visitor page reveals no destination or reason', !page410.includes('t33-reported-destination') && !page410.includes('internal note'));
    await ownerPage.reload();
    await ownerPage.getByText(`/r/${alias}`).first().waitFor();
    const ownerRow = await ownerPage.locator('li', { hasText: `/r/${alias}` }).innerText();
    check('the owner sees "Blocked" without the reason and cannot enable it', ownerRow.includes('Blocked') && !ownerRow.includes('internal note') && !ownerRow.includes('Enable'));

    // Unblock → effective status from the API, link works again.
    await act('Unblock link', 'T33: owner fixed the page.', 'Unblock link');
    await adminPage.getByText('Link unblocked.').waitFor();
    check('after unblocking the status is Active and the link redirects', (await adminPage.locator('.detail app-status-badge').innerText()).includes('Active') && (await status(alias)) === 302);

    // Suspend the owner → links stop, the owner's next action explains the suspension.
    await act('Suspend owner', 'T33: spam campaign (internal note).', 'Suspend account');
    await adminPage.getByText('Account suspended.').waitFor();
    check('suspending the owner makes their links answer 410', (await status(alias)) === 410);
    await ownerPage.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Analytics' }).click();
    check('the owner is signed out and told the account is suspended', await ownerPage.getByText(/This account is suspended/).waitFor({ timeout: 10000 }).then(() => true, () => false));

    // Reactivate → links work; the owner must sign in again.
    await act('Reactivate owner', 'T33: appeal accepted.', 'Reactivate account');
    await adminPage.getByText('Account reactivated.').waitFor();
    check('reactivating restores the links (302)', (await status(alias)) === 302);
    await logIn(ownerPage, owner);
    check('the owner can sign in again', true);

    // Every action is in the history with its reason.
    const history = await adminPage.locator('.detail .history').innerText();
    check('the history lists every action with its reason', ['Report resolved', 'Link blocked', 'Link unblocked', 'Account suspended', 'Account reactivated'].every((label) => history.includes(label)) && history.includes('T33: appeal accepted.'));
  } catch (error) {
    results.push(['journey stopped', `FAIL ${String(error.message).split('\n')[0]} (after: ${results.at(-1)?.[0] ?? 'start'})`]);
    await adminPage.screenshot({ path: '.playwright-mcp/t33-j4-failure-admin.png', fullPage: true }).catch(() => null);
    await ownerPage.screenshot({ path: '.playwright-mcp/t33-j4-failure-owner.png', fullPage: true }).catch(() => null);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }

  return { owner: owner.email, alias, results };
}
