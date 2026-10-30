import pg from 'pg';

import { normalizeEmail } from '../modules/accounts/rules/email.js';

// OPERATOR TOOL: grants or removes the admin role (technical-design §6: role assignment is an
// operator-only action, never accepted from public input or any API). Run where DATABASE_URL
// points at the database, for example inside the API container:
//
//   docker compose exec api node src/cli/set-role.js person@example.com admin
//   docker compose exec api node src/cli/set-role.js person@example.com user
//
// The change applies on the account's next request (roles are read from the users row). Admin
// sessions have shorter lifetimes, so the person should sign in again after a promotion.

const [rawEmail, role] = process.argv.slice(2);
const email = rawEmail ? normalizeEmail(rawEmail) : '';

if (!email || !['admin', 'user'].includes(role)) {
  console.error('Usage: node src/cli/set-role.js <email> <admin|user>');
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  // Demoting the last active admin would leave no one able to moderate.
  if (role === 'user') {
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND email_normalized <> $1",
      [email],
    );

    if (rows[0].n === 0) {
      console.error('Refusing: this would remove the last active administrator.');
      process.exitCode = 1;
    }
  }

  if (process.exitCode !== 1) {
    // Bumping session_version signs the account out everywhere, so the new role starts with a
    // fresh session and its own lifetime.
    const { rowCount } = await client.query(
      'UPDATE users SET role = $2, session_version = session_version + 1, updated_at = now() WHERE email_normalized = $1',
      [email, role],
    );

    if (rowCount === 0) {
      console.error('No account with that email address.');
      process.exitCode = 1;
    } else {
      console.log(`Role set to ${role}. The account must sign in again.`);
    }
  }
} catch (error) {
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
