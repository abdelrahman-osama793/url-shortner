// T33 journey 3: password recovery, one-time links, and a session ended elsewhere.
// Run with the Playwright MCP tool (browser_run_code_unsafe, filename=this file) against the
// local stack: ng serve on :4200, Docker API on :3000, Mailpit on :8025.
async (page) => {
  const base = 'http://localhost:4200';
  const mailpit = 'http://localhost:8025';
  const results = [];
  const check = (name, ok, detail = '') => results.push([name, ok ? 'pass' : `FAIL ${detail}`]);
  const stamp = Date.now().toString(36);
  const email = `t33-recover-${stamp}@example.test`;
  const oldPassword = `local-old-${stamp}-x1`;
  const newPassword = `local-new-${stamp}-y2`;

  const browser = page.context().browser();
  const tabA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tabB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await tabA.newPage();
  const b = await tabB.newPage();

  const linkFromMail = async (kind, skip = 0) => {
    for (let i = 0; i < 30; i += 1) {
      const list = await (await b.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      const links = [];

      for (const message of list.messages ?? []) {
        const text = (await (await b.request.get(`${mailpit}/api/v1/message/${message.ID}`)).json()).Text;
        const link = text.match(new RegExp(`http\\S+${kind}\\S+`))?.[0];

        if (link) links.push(link);
      }
      if (links.length > skip) return links[0];
      await b.waitForTimeout(500);
    }

    throw new Error(`no ${kind} email`);
  };
  const logIn = async (p, password) => {
    await p.goto(`${base}/login`);
    await p.locator('#email').fill(email);
    await p.locator('#password').fill(password);
    await p.getByRole('button', { name: 'Log in' }).click();
  };

  try {
    // A verified account, signed in on "device A".
    await a.goto(`${base}/signup`);
    await a.locator('#email').fill(email);
    await a.locator('#password').fill(oldPassword);
    await a.getByRole('button', { name: 'Create account' }).click();
    await a.waitForURL('**/signup/check-email');
    await a.goto(await linkFromMail('verify-email'));
    await a.getByRole('button', { name: 'Confirm email address' }).click();
    await a.getByText('Email verified').waitFor();
    await logIn(a, oldPassword);
    await a.waitForURL('**/app/links');

    // "Device B" forgets the password. The answer is the same for unknown addresses.
    await b.goto(`${base}/forgot-password`);
    await b.locator('#email').fill(`nobody-${stamp}@example.test`);
    await b.getByRole('button', { name: /Send reset link/ }).click();
    await b.getByText('Check your inbox').waitFor();
    const unknownCopy = (await b.locator('.auth-intro').innerText()).replace(`nobody-${stamp}@example.test`, 'X');
    await b.getByRole('button', { name: 'Use a different email' }).click();
    await b.locator('#email').fill(email);
    await b.getByRole('button', { name: /Send reset link/ }).click();
    await b.getByText('Check your inbox').waitFor();
    const knownCopy = (await b.locator('.auth-intro').innerText()).replace(email, 'X');
    check('the confirmation reads the same for known and unknown addresses', unknownCopy === knownCopy);

    // Reset: the token leaves the address; mismatched passwords are refused; then success.
    const resetLink = await linkFromMail('reset-password');
    await b.goto(resetLink);
    check('the reset token is removed from the address', await b.waitForFunction(() => !location.href.includes('token='), null, { timeout: 5000 }).then(() => true, () => false));
    await b.locator('#new-password').fill(newPassword);
    await b.locator('#confirm-password').fill(`${newPassword}-typo`);
    await b.getByRole('button', { name: /Reset password/ }).click();
    check('mismatched passwords are refused', await b.getByText("The passwords don't match.").waitFor({ timeout: 3000 }).then(() => true, () => false));
    await b.locator('#confirm-password').fill(newPassword);
    await b.getByRole('button', { name: /Reset password/ }).click();
    await b.getByText('Password reset complete').waitFor();
    check('the reset completes', true);

    // The same link again: "already used". (A fresh page load, as when the email is clicked: a
    // fragment-only change on the same page would not reopen it.)
    const open = async (url) => {
      await b.goto('about:blank');
      await b.goto(url);
    };

    await open(resetLink);
    await b.locator('#new-password').fill(newPassword);
    await b.locator('#confirm-password').fill(newPassword);
    await b.getByRole('button', { name: /Reset password/ }).click();
    check('a used reset link says so', await b.getByText('This link was already used').waitFor({ timeout: 5000 }).then(() => true, () => false));

    // A tampered or missing token: "isn't valid".
    await open(`${base}/reset-password#token=not-a-real-token`);
    await b.locator('#new-password').fill(newPassword);
    await b.locator('#confirm-password').fill(newPassword);
    await b.getByRole('button', { name: /Reset password/ }).click();
    check('an invalid reset link says so', await b.getByText("This link isn't valid").waitFor({ timeout: 5000 }).then(() => true, () => false));
    await open(`${base}/verify-email`);
    check('a verification page without a token says so', await b.getByText("This link isn't valid").waitFor({ timeout: 5000 }).then(() => true, () => false));

    // Device A was signed out by the reset: its next action goes to Log in with an explanation.
    await a.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Analytics' }).click();
    const ended = await a.waitForURL('**/login**', { timeout: 10000 }).then(() => true, () => false);
    check('the other device is signed out by the reset', ended);
    check('it explains that the session ended', (await a.getByText(/Your session has ended|Please log in to continue/).count()) > 0);

    // Old password refused, new one works.
    await logIn(b, oldPassword);
    check('the old password no longer works', await b.getByText('The email or password is incorrect.').waitFor({ timeout: 5000 }).then(() => true, () => false));
    await logIn(b, newPassword);
    check('the new password works', await b.waitForURL('**/app/links', { timeout: 10000 }).then(() => true, () => false));
  } catch (error) {
    results.push(['journey stopped', `FAIL ${String(error.message).split('\n')[0]} (after: ${results.at(-1)?.[0] ?? 'start'})`]);
    await b.screenshot({ path: '.playwright-mcp/t33-j3-failure-b.png', fullPage: true }).catch(() => null);
    await a.screenshot({ path: '.playwright-mcp/t33-j3-failure-a.png', fullPage: true }).catch(() => null);
  } finally {
    await tabA.close();
    await tabB.close();
  }

  return { email, results };
}
