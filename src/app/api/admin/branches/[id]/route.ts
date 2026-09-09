import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  fail,
  ok,
  scopeRestaurantId,
  writeAudit,
  unauthorized,
  forbidden,
} from '@/lib/api-helpers'
import { hasPermissionAsync } from '@/lib/auth'
import { branchSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function getBranchOr404(id: string, restaurantId: string | null) {
  const branch = await db.branch.findUnique({ where: { id } })
  if (!branch) return null
  if (restaurantId && branch.restaurantId !== restaurantId) return null
  return branch
}

/** Owner / super admin guard shared by PATCH & DELETE. */
async function requireBranchManage(restaurantIdOverride?: string | null) {
  const user = await requireAuth()
  if (!user) return { user: null, error: unauthorized() }
  const allowed = await hasPermissionAsync(user.role as string, 'branches.manage')
  if (!allowed) return { user: null, error: forbidden('Only the restaurant owner can manage branches.') }
  const restaurantId = scopeRestaurantId(user, restaurantIdOverride ?? null)
  return { user, restaurantId, error: null as null }
}

// PATCH /api/admin/branches/[id] — rename / relocate / toggle active
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { user, restaurantId, error } = await requireBranchManage(
    req.nextUrl.searchParams.get('restaurantId'),
  )
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const branch = await getBranchOr404(id, restaurantId)
  if (!branch) return fail('Branch not found.', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = branchSchema.partial().safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  const updated = await db.branch.update({
    where: { id: branch.id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.address !== undefined ? { address: data.address.trim() } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  })

  writeAudit(user, 'UPDATE', 'BRANCH', branch.id, {
    name: updated.name,
    active: updated.active,
  })
  return ok(updated)
}

// DELETE /api/admin/branches/[id]
//
// The Branch→User relation is `onDelete: Cascade` in the schema, which would
// silently DELETE every staff account assigned to the branch. Detach the
// staff first (they fall back to restaurant-wide scope), then delete the
// branch. Tables and orders keep existing — their branchId is cleared
// automatically (onDelete: SetNull).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { user, restaurantId, error } = await requireBranchManage(
    req.nextUrl.searchParams.get('restaurantId'),
  )
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const branch = await getBranchOr404(id, restaurantId)
  if (!branch) return fail('Branch not found.', 404)

  const staffCount = await db.user.count({ where: { branchId: branch.id } })

  await db.$transaction([
    // Detach staff BEFORE delete — the schema cascade would otherwise
    // hard-delete their accounts.
    db.user.updateMany({
      where: { branchId: branch.id },
      data: { branchId: null },
    }),
    db.branch.delete({ where: { id: branch.id } }),
  ])

  writeAudit(user, 'DELETE', 'BRANCH', branch.id, {
    name: branch.name,
    detachedStaff: staffCount,
  })
  return ok({ deleted: true, detachedStaff: staffCount })
}
