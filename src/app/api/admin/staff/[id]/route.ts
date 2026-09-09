import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { staffUpdateSchema } from '@/lib/validations'
import { canAccessRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/staff/[id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('staff.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const target = await db.user.findUnique({ where: { id } })
  if (!target) return fail('User not found.', 404)

  // Cannot edit super admin unless you are one
  if (target.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return fail('You cannot edit a super admin.', 403)
  }
  // Tenant scope
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (
    restaurantId &&
    target.restaurantId !== restaurantId &&
    target.role !== 'SUPER_ADMIN'
  ) {
    return fail('User not found.', 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = staffUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // A branchId (if provided) must reference a branch of the caller's restaurant.
  if (data.branchId) {
    const branch = await db.branch.findUnique({ where: { id: data.branchId } })
    if (!branch || (restaurantId && branch.restaurantId !== restaurantId)) {
      return fail('Invalid branch — it does not belong to your restaurant.', 422)
    }
  }

  // Role change permission
  if (data.role && data.role !== target.role) {
    if (data.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
      return fail('Only super admin can grant SUPER_ADMIN role.', 403)
    }
    if (!canAccessRole(user.role as string, data.role)) {
      return fail(`You cannot assign role ${data.role}.`, 403)
    }
  }

  // Cannot deactivate yourself
  if (data.active === false && target.id === user.id) {
    return fail('You cannot deactivate your own account.', 400)
  }

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.role !== undefined) updateData.role = data.role
  if (data.active !== undefined) updateData.active = data.active
  if (data.phone !== undefined) updateData.phone = data.phone || null
  if (data.branchId !== undefined) updateData.branchId = data.branchId || null
  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 10)
  }

  const updated = await db.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      phone: true,
      restaurantId: true,
      branchId: true,
    },
  })
  writeAudit(user, 'UPDATE', 'USER', id, updateData)
  return ok(updated)
}

// DELETE /api/admin/staff/[id]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('staff.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  if (id === user.id) return fail('You cannot delete your own account.', 400)

  const target = await db.user.findUnique({ where: { id } })
  if (!target) return fail('User not found.', 404)
  if (target.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return fail('You cannot delete a super admin.', 403)
  }
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (
    restaurantId &&
    target.restaurantId !== restaurantId &&
    target.role !== 'SUPER_ADMIN'
  ) {
    return fail('User not found.', 404)
  }

  // Soft delete: deactivate rather than remove (preserve audit trail)
  const updated = await db.user.update({
    where: { id },
    data: { active: false },
  })
  writeAudit(user, 'DELETE', 'USER', id, { soft: true, email: target.email })
  return ok({ deactivated: true, user: updated })
}
