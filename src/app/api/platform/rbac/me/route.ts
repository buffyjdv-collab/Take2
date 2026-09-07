import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  ok,
  fail,
} from '@/lib/api-helpers'
import {
  SIDEBAR_MODULES,
  DEFAULT_MODULE_VISIBILITY,
  getVisibleModulesForRole,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/platform/rbac/me
// Returns the list of sidebar module keys visible to the current user.
// The sidebar component uses this to decide which nav items to show.
//
// Response: { modules: ['dashboard', 'orders', 'menu', ...] }
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return fail('Unauthorized', 401)

  const role = user.role as string
  if (role === 'SUPER_ADMIN') {
    return ok({ modules: SIDEBAR_MODULES.map((m) => m.key) })
  }

  // Use the helper that consults DB overrides (with in-process cache).
  // For non-super-admin roles, we still apply DEFAULT_MODULE_VISIBILITY for
  // any (role, moduleKey) tuples that have no DB override.
  const allKeys = SIDEBAR_MODULES.map((m) => m.key)
  const visible = await getVisibleModulesForRole(role, allKeys)
  return ok({ modules: visible })
}
