import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  scopeBranchId,
  writeAudit,
  enforcePlanLimit,
} from '@/lib/api-helpers'
import { staffCreateSchema } from '@/lib/validations'
import { canAccessRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/admin/staff
// Owners see every staff member of the restaurant; branch-scoped MANAGERs
// see ONLY their own branch's team (their own staff details, nothing else).
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('staff.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const branchId = scopeBranchId(user)
  // SUPER_ADMIN without restaurantId filter sees everyone
  const where = restaurantId
    ? { restaurantId, ...(branchId ? { branchId } : {}) }
    : {}
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
      approvalStatus: true,
      reviewNote: true,
      reviewedAt: true,
      createdAt: true,
      restaurant: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      requestedByUser: { select: { id: true, name: true } },
      reviewedByUser: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok(users)
}

// POST /api/admin/staff
//
// Owners / super admins create staff directly (active immediately).
// Branch MANAGERS can hire their own branch's staff, but every account they
// create stays INACTIVE + PENDING until the restaurant owner approves it
// from the Approvals centre.
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
  // A branch MANAGER cannot create another MANAGER — managers are appointed
  // by the owner from the Branches page.
  if (data.role === 'MANAGER' && user.role === 'MANAGER') {
    return fail('Only the restaurant owner can create managers.', 403)
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

  // Branch assignment: a branch manager ALWAYS hires into their own branch.
  const managerBranchId = scopeBranchId(user)
  const targetBranchId = managerBranchId || data.branchId || null

  // A branchId (if provided) must reference a branch of the target restaurant.
  if (targetBranchId) {
    const branch = await db.branch.findUnique({ where: { id: targetBranchId } })
    if (!branch || (finalRestaurantId && branch.restaurantId !== finalRestaurantId)) {
      return fail('Invalid branch — it does not belong to your restaurant.', 422)
    }
  }

  // Plan limit enforcement (skip for SUPER_ADMIN creation — platform-level)
  if (data.role !== 'SUPER_ADMIN' && finalRestaurantId) {
    const limitErr = await enforcePlanLimit(finalRestaurantId, 'maxStaff')
    if (limitErr) return limitErr
  }

  // Owner-approval workflow: staff created by a branch MANAGER wait for the
  // owner's sign-off before they can sign in.
  const pending = user.role === 'MANAGER'

  const passwordHash = await bcrypt.hash(data.password, 10)
  const newUser = await db.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash,
      role: data.role,
      phone: data.phone || null,
      restaurantId: data.role === 'SUPER_ADMIN' ? null : finalRestaurantId,
      branchId: data.role === 'SUPER_ADMIN' ? null : targetBranchId,
      active: !pending,
      approvalStatus: pending ? 'PENDING' : 'APPROVED',
      requestedStaffById: pending ? user.id : null,
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
      approvalStatus: true,
      reviewNote: true,
      requestedByUser: { select: { id: true, name: true } },
      reviewedByUser: { select: { id: true, name: true } },
    },
  })
  writeAudit(user, 'CREATE', 'USER', newUser.id, {
    email: newUser.email,
    role: newUser.role,
    branchId: targetBranchId,
    approvalStatus: newUser.approvalStatus,
  })
  return ok(newUser, 201)
}
