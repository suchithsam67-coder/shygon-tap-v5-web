/**
 * Shared plumbing for the SHYGON admin Edge Functions.
 *
 * These are the ONLY two operations that cannot happen inside Postgres:
 * calling the Razorpay API and calling Expo's push service. Everything else an
 * administrator does is a SECURITY DEFINER RPC, checked in the same transaction
 * as the write, with no service-role key anywhere in the path.
 *
 * Nothing here is ever bundled into the Admin APK. These run on Supabase's
 * infrastructure and read their secrets from the function environment.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

export class MissingSecretError extends Error {
  constructor(readonly secretName: string) {
    super(`Server misconfiguration: required secret ${secretName} is not set`);
  }
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim().length === 0) throw new MissingSecretError(name);
  return value.trim();
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

/**
 * The Admin APK is a native client, so it is not subject to CORS. These headers
 * exist so the same functions can be called from a browser-based admin console
 * later without a second implementation.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Service-role client. Deliberately created with NO Authorization header from
 * the request: passing the caller's JWT alongside the service key would make
 * `auth.uid()` non-null inside Postgres, and the payment trigger in migration
 * 001 refuses payment mutations from any context that has one. The whole point
 * of this client is to be the same "no auth.uid()" context the Razorpay webhook
 * already uses.
 */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface ActingAdmin {
  userId: string;
  role: string;
  permissions: string[];
  displayName: string | null;
}

/**
 * Resolves the caller to an active administrator, or returns null.
 *
 * The permission set is re-derived from the database rather than read from the
 * request: a token proves who you are, never what you may do.
 */
export async function resolveAdmin(
  service: SupabaseClient,
  request: Request,
  permission: string,
): Promise<ActingAdmin | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const { data, error } = await service.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: row, error: adminError } = await service
    .from('admin_users')
    .select('user_id, role, permissions, is_active, display_name')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (adminError) {
    console.error('admin lookup failed', adminError.message);
    return null;
  }
  if (!row || row.is_active !== true) return null;

  const effective = new Set<string>([
    ...rolePermissions(row.role as string),
    ...((row.permissions as string[] | null) ?? []),
  ]);
  if (!effective.has(permission)) return null;

  return {
    userId: row.user_id as string,
    role: row.role as string,
    permissions: [...effective],
    displayName: (row.display_name as string | null) ?? null,
  };
}

/**
 * Mirror of public.admin_role_permissions() in migration 003. Duplicated rather
 * than queried because these two functions must keep working if PostgREST is
 * mid-deploy — and because an extra round trip per request buys nothing. If the
 * catalogue in 003 changes, change it here in the same commit.
 */
export function rolePermissions(role: string): string[] {
  switch (role) {
    case 'owner':
      return [
        'orders.read', 'orders.fulfil', 'orders.cancel', 'orders.refund',
        'customers.read', 'customers.manage', 'tap.read', 'tap.moderate',
        'products.read', 'products.manage', 'inventory.read', 'inventory.manage',
        'entitlements.read', 'entitlements.grant', 'support.read', 'support.respond',
        'analytics.read', 'audit.read', 'admins.manage',
      ];
    case 'admin':
      return [
        'orders.read', 'orders.fulfil', 'orders.cancel', 'orders.refund',
        'customers.read', 'customers.manage', 'tap.read', 'tap.moderate',
        'products.read', 'products.manage', 'inventory.read', 'inventory.manage',
        'entitlements.read', 'entitlements.grant', 'support.read', 'support.respond',
        'analytics.read', 'audit.read',
      ];
    case 'fulfilment':
      return [
        'orders.read', 'orders.fulfil', 'customers.read', 'tap.read',
        'products.read', 'inventory.read', 'inventory.manage', 'analytics.read',
      ];
    case 'support':
      return [
        'orders.read', 'customers.read', 'tap.read', 'entitlements.read',
        'support.read', 'support.respond', 'products.read', 'analytics.read',
      ];
    case 'viewer':
      return [
        'orders.read', 'customers.read', 'tap.read', 'products.read',
        'inventory.read', 'entitlements.read', 'support.read', 'analytics.read',
      ];
    default:
      return [];
  }
}

export async function audit(
  service: SupabaseClient,
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  // An unrecorded privileged action is a real problem, but it must not undo a
  // refund that already left the gateway. Log loudly instead.
  if (error) console.error('AUDIT WRITE FAILED', action, entityId, error.message);
}
