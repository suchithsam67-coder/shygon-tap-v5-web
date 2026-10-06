// The local stack's database (V6, D-4): the live schema baseline, the
// migrations from 020 on, and what a hosted project adds around them.
import fs from 'node:fs';
import path from 'node:path';
import { createMigratedDb, ROOT } from '../tests/lib/live-db.mjs';
import { AUTH_USERS_EXTENSION } from './auth.mjs';

/**
 * A fresh in-memory database, shaped like a hosted Supabase project:
 *  - the API roles may use the public schema, and service_role has
 *    BYPASSRLS, as on every hosted project (the shims leave both out);
 *  - auth.users has the columns the local Auth subset keeps (password hash,
 *    confirmation and sign-in times);
 *  - the catalogue fixture (seed.sql), unless `seed: false`.
 */
export async function createStackDb({ seed = true } = {}) {
  const db = await createMigratedDb();
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER ROLE service_role BYPASSRLS;
    ${AUTH_USERS_EXTENSION}
  `);
  if (seed) await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'local', 'seed.sql'), 'utf8'));
  return db;
}
