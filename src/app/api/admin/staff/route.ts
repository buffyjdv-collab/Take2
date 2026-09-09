import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
  enforcePlanLimit,
} from '@/lib/api-helpers'
import { staffCreateSchema } from '@/lib/validations'
import { canAccessRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/admin/staff
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('staff.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  // SUPER_ADMIN without restaurantId filter sees everyone
  const where = restaurantId ? { restaurantId } : {}
  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      phone: true,
      avatar: true,
      restaurantId: true,
      branchId: true,
      createdAt: true,
      restaurant: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(users)
}

// POST /api/admin/staff
export async function POST(req: NextRequest) {
  const { user, error } = await requirePermission('staff.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  // Restaurant scope for non-super admins
  let restaurantId: string | null = null
  if (user.role === 'SUPER_ADMIN') {
    // may specify in body
  } else {
    restaurantId = user.restaurantId as string
    if (!restaurantId) return fail('You are not assigned to a restaurant.', 400)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = staffCreateSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // Owner cannot create SUPER_ADMIN
  if (data.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return fail('Cannot create super admin.', 403)
  }
  // Restaurant owner cannot create RESTAURANT_OWNER for another restaurant
  if (data.role === 'RESTAURANT_OWNER' && user.role === 'RESTAURANT_OWNER') {
    return fail('Only super admin can create restaurant owners.', 403)
  }
  if (!canAccessRole(user.role as string, data.role)) {
    return fail(`You cannot create a user with role ${data.role}.`, 403)
  }

  const existing = await db.user.findUnique({ where: { email: data.email.toLowerCase() } })
  if (existing) return fail('Email already in use.', 409)

  // For super admin creating owner, restaurantId must be provided in body
  const finalRestaurantId =
    user.role === 'SUPER_ADMIN'
      ? (body as any)?.restaurantId || restaurantId
      : restaurantId

  if (data.role !== 'SUPER_ADMIN' && !finalRestaurantId) {
    return fail('Restaurant is required for this role.', 400)
  }

  // A branchId (if provided) must reference a branch of the target restaurant.
  if (data.branchId) {
    const branch = await db.branch.findUnique({ where: { id: data.branchId } })
    if (!branch || (finalRestaurantId && branch.restaurantId !== finalRestaurantId)) {
      return fail('Invalid branch — it does not belong to your restaurant.', 422)
    }
  }

  // Plan limit enforcement (skip for SUPER_ADMIN creation — platform-level)
  if (data.role !== 'SUPER_ADMIN' && finalRestaurantId) {
    const limitErr = await enforcePlanLimit(finalRestaurantId, 'maxStaff')
    if (limitErr) return limitErr
  }

  const passwordHash = await bcrypt.hash(data.password, 10)
  const newUser = await db.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash,
      role: data.role,
      phone: data.phone || null,
      restaurantId: data.role === 'SUPER_ADMIN' ? null : finalRestaurantId,
      branchId: data.branchId || null,
      active: true,
    },
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
  writeAudit(user, 'CREATE', 'USER', newUser.id, {
    email: newUser.email,
    role: newUser.role,
  })
  return ok(newUser, 201)
}
