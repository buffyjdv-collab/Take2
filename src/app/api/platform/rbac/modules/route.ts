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
  SIDEBAR_MODULES,
  DEFAULT_MODULE_VISIBILITY,
  invalidateModuleCache,
} from '@/lib/auth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// GET /api/platform/rbac/modules
// Returns the module visibility matrix: every (role, moduleKey) tuple with
// its current `visible` value. Tuples without a DB row fall back to the
// static DEFAULT_MODULE_VISIBILITY.
//
// Response shape:
//   {
//     modules: [{ key, label, group }, ...],
//     roles: ['RESTAURANT_OWNER', 'MANAGER', ...],
//     matrix: {
//       'MANAGER': {
//         'dashboard': true,
//         'staff': false,
//         ...
//       },
//       ...
//     }
//   }
export async function GET() {
  const { user, error } = await requirePermission('RBAC.MANAGE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const overrides = await db.roleModuleAccess.findMany()
  const overrideMap = new Map<string, boolean>()
  for (const o of overrides) {
    overrideMap.set(`${o.role}:${o.moduleKey}`, o.visible)
  }

  const roles = ALL_ROLES.filter((r) => r !== 'SUPER_ADMIN')
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const role of roles) {
    matrix[role] = {}
    for (const mod of SIDEBAR_MODULES) {
      const overrideKey = `${role}:${mod.key}`
      if (overrideMap.has(overrideKey)) {
        matrix[role][mod.key] = overrideMap.get(overrideKey)!
      } else {
        const def = DEFAULT_MODULE_VISIBILITY[mod.key]
        matrix[role][mod.key] = def ? def.includes(role) : false
      }
    }
  }

  return ok({
    modules: SIDEBAR_MODULES,
    roles,
    matrix,
    superAdminNote: 'SUPER_ADMIN always sees every module.',
  })
}

// PUT /api/platform/rbac/modules
// Body: {
//   updates: [
//     { role, moduleKey, visible },
//     ...
//   ]
// }
const updateSchema = z.object({
  updates: z
    .array(
      z.object({
        role: z.enum(ALL_ROLES),
        moduleKey: z.string().min(1).max(60),
        visible: z.boolean(),
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

  // Reject attempts to restrict SUPER_ADMIN
  const superAdminUpdates = updates.filter((u) => u.role === 'SUPER_ADMIN')
  if (superAdminUpdates.length > 0) {
    return fail(
      'SUPER_ADMIN always sees every module and cannot be restricted.',
      403,
    )
  }

  // Validate module keys exist in the catalog
  const knownKeys = new Set(SIDEBAR_MODULES.map((m) => m.key))
  for (const u of updates) {
    if (!knownKeys.has(u.moduleKey)) {
      return fail(`Unknown module key: ${u.moduleKey}`, 422)
    }
  }

  await db.$transaction(async (tx) => {
    for (const u of updates) {
      const def = DEFAULT_MODULE_VISIBILITY[u.moduleKey] || []
      const defaultVisible = def.includes(u.role)

      if (u.visible === defaultVisible) {
        // Matches static default — delete any override
        await tx.roleModuleAccess.deleteMany({
          where: { role: u.role, moduleKey: u.moduleKey },
        })
      } else {
        await tx.roleModuleAccess.upsert({
          where: {
            role_moduleKey: {
              role: u.role,
              moduleKey: u.moduleKey,
            },
          },
          create: {
            role: u.role,
            moduleKey: u.moduleKey,
            visible: u.visible,
            updatedBy: user.id,
          },
          update: {
            visible: u.visible,
            updatedBy: user.id,
          },
        })
      }
    }
  })

  for (const u of updates) invalidateModuleCache(u.role)

  writeAudit(user, 'UPDATE', 'RBAC_MODULES', null, {
    count: updates.length,
    updates: updates.map((u) => ({
      role: u.role,
      moduleKey: u.moduleKey,
      visible: u.visible,
    })),
  })

  return ok({ updated: updates.length })
}
