import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  writeAudit,
} from '@/lib/api-helpers'
import {
  ALL_ROLES,
  RBAC_RESOURCES,
  DEFAULT_PERMISSIONS,
  invalidateRbacCache,
} from '@/lib/auth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// GET /api/platform/rbac/permissions
// Returns the full permission matrix: every (role, resource, action) tuple
// with its current `allowed` value. Tuples without a DB row fall back to the
// static DEFAULT_PERMISSIONS.
//
// Response shape:
//   {
//     resources: [{ key, label, actions: [...] }, ...],
//     roles: ['SUPER_ADMIN', 'RESTAURANT_OWNER', ...],
//     matrix: {
//       'MANAGER': {
//         'MENU_ITEM.CREATE': true,
//         'MENU_ITEM.DELETE': false,
//         ...
//       },
//       ...
//     }
//   }
export async function GET() {
  const { user, error } = await requirePermission('RBAC.MANAGE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  // Load all overrides (one query)
  const overrides = await db.rolePermission.findMany()
  const overrideMap = new Map<string, boolean>()
  for (const o of overrides) {
    overrideMap.set(`${o.role}:${o.resource}.${o.action}`, o.allowed)
  }

  // Build matrix: { [role]: { [RESOURCE.ACTION]: boolean } }
  const roles = ALL_ROLES.filter((r) => r !== 'SUPER_ADMIN') // SUPER_ADMIN always has everything
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const role of roles) {
    matrix[role] = {}
    for (const res of RBAC_RESOURCES) {
      for (const action of res.actions) {
        const key = `${res.key}.${action}`
        const overrideKey = `${role}:${key}`
        if (overrideMap.has(overrideKey)) {
          matrix[role][key] = overrideMap.get(overrideKey)!
        } else {
          // Fall back to static default
          const def = DEFAULT_PERMISSIONS[key]
          matrix[role][key] = def ? def.includes(role) : false
        }
      }
    }
  }

  return ok({
    resources: RBAC_RESOURCES,
    roles,
    matrix,
    // SUPER_ADMIN is implicit — always allow everything.
    superAdminNote: 'SUPER_ADMIN always has every permission and cannot be restricted.',
  })
}

// PUT /api/platform/rbac/permissions
// Body: {
//   updates: [
//     { role, resource, action, allowed },
//     ...
//   ]
// }
// Each update either creates or updates a RolePermission row. Setting
// `allowed` to the static default value will delete the override row (so the
// system falls back to the static map) — this keeps the table small.
const updateSchema = z.object({
  updates: z
    .array(
      z.object({
        role: z.enum(ALL_ROLES),
        resource: z.string().min(1).max(60),
        action: z.string().min(1).max(40),
        allowed: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
})

export async function PUT(req: NextRequest) {
  const { user, error } = await requirePermission('RBAC.MANAGE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const { updates } = parsed.data

  // Reject any attempt to restrict SUPER_ADMIN (super admin always has everything)
  const superAdminUpdates = updates.filter((u) => u.role === 'SUPER_ADMIN')
  if (superAdminUpdates.length > 0) {
    return fail(
      'SUPER_ADMIN always has every permission and cannot be restricted.',
      403,
    )
  }

  // Validate that resource+action pairs exist in the catalog
  const knownKeys = new Set(
    RBAC_RESOURCES.flatMap((r) => r.actions.map((a) => `${r.key}.${a}`)),
  )
  for (const u of updates) {
    const key = `${u.resource}.${u.action}`
    if (!knownKeys.has(key)) {
      return fail(`Unknown permission: ${key}`, 422)
    }
  }

  // Apply updates in a transaction: upsert rows where the new value differs
  // from the static default; delete rows where it matches the default (so the
  // table stays small and the static map remains the source of truth).
  await db.$transaction(async (tx) => {
    for (const u of updates) {
      const key = `${u.resource}.${u.action}`
      const defaultRoles = DEFAULT_PERMISSIONS[key] || []
      const defaultAllowed = defaultRoles.includes(u.role)

      if (u.allowed === defaultAllowed) {
        // Matches static default — delete any existing override
        await tx.rolePermission.deleteMany({
          where: { role: u.role, resource: u.resource, action: u.action },
        })
      } else {
        // Differs from static default — upsert the override
        await tx.rolePermission.upsert({
          where: {
            role_resource_action: {
              role: u.role,
              resource: u.resource,
              action: u.action,
            },
          },
          create: {
            role: u.role,
            resource: u.resource,
            action: u.action,
            allowed: u.allowed,
            updatedBy: user.id,
          },
          update: {
            allowed: u.allowed,
            updatedBy: user.id,
          },
        })
      }
    }
  })

  // Invalidate in-process cache so the new permissions take effect immediately
  for (const u of updates) invalidateRbacCache(u.role)

  writeAudit(user, 'UPDATE', 'RBAC_PERMISSIONS', null, {
    count: updates.length,
    updates: updates.map((u) => ({
      role: u.role,
      key: `${u.resource}.${u.action}`,
      allowed: u.allowed,
    })),
  })

  return ok({ updated: updates.length })
}
