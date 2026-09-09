import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, hasPermissionAsync } from '@/lib/auth'
import type { Role } from '@/lib/types'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role | string
  restaurantId?: string | null
  branchId?: string | null
  restaurantName?: string | null
  restaurantSlug?: string | null
  branchName?: string | null
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const u = session.user as SessionUser
  if (!u.id || !u.role) return null
  return u
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status })
}

/**
 * Returns the session user or a 401 response.
 */
export async function requireAuth(): Promise<SessionUser | null> {
  const u = await getSessionUser()
  return u
}

export function unauthorized() {
  return fail('Unauthorized — please sign in.', 401)
}

export function forbidden(detail = 'You do not have permission to perform this action.') {
  return fail(detail, 403)
}

/**
 * Returns the restaurantId scope for the current user.
 * SUPER_ADMIN can override via `restaurantId` query param; others
 * are pinned to their own restaurantId.
 */
export function scopeRestaurantId(
  user: SessionUser,
  override?: string | null,
): string | null {
  if (user.role === 'SUPER_ADMIN') {
    return override || null
  }
  return user.restaurantId || null
}

/**
 * Branch scope for branch-assigned staff (MANAGER / KITCHEN_STAFF / WAITER /
 * CASHIER whose account is attached to a single branch). Returns the user's
 * branchId, or null when the caller should see the whole restaurant
 * (SUPER_ADMIN / RESTAURANT_OWNER, or staff not assigned to any branch).
 *
 * Used by the admin list/report APIs to filter data down to the caller's
 * branch so a branch manager only monitors & manages their own location.
 */
export function scopeBranchId(user: SessionUser): string | null {
  if (user.role === 'SUPER_ADMIN' || user.role === 'RESTAURANT_OWNER') {
    return null
  }
  return user.branchId || null
}

/**
 * Guard helper for single-entity action routes (status change, cash
 * collection, …). Returns true when the caller is allowed to act on an
 * entity that lives in `entityBranchId` — false when a branch-scoped staff
 * member tries to touch another branch's entity.
 */
export function canActOnBranch(user: SessionUser, entityBranchId: string | null): boolean {
  const branchId = scopeBranchId(user)
  if (!branchId) return true
  return entityBranchId === branchId
}

export async function requirePermission(permission: string) {
  const user = await getSessionUser()
  if (!user) return { user: null, error: unauthorized() }
  const allowed = await hasPermissionAsync(user.role as string, permission)
  if (!allowed) {
    return { user: null, error: forbidden() }
  }
  return { user, error: null }
}

export function inr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function generateOrderNumber(prefix: string, count: number): string {
  // e.g. SG-000001
  const padded = String(count + 1).padStart(6, '0')
  return `${prefix}-${padded}`
}

export function generateInvoiceNumber(prefix: string, count: number): string {
  const padded = String(count + 1).padStart(6, '0')
  return `${prefix}-INV-${padded}`
}

export function generateToken(prefix: string, length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < length; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${prefix}-${s}`
}

export function restaurantPrefix(name: string): string {
  const words = name.trim().split(/\s+/)
  const init = words
    .slice(0, 2)
    .map((w) => w.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())
    .join('')
  return init || 'ORD'
}

export async function writeAudit(
  user: SessionUser | null,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  try {
    const { db } = await import('@/lib/db')
    await db.auditLog.create({
      data: {
        restaurantId: user?.restaurantId || null,
        userId: user?.id || null,
        action,
        entity,
        entityId,
        details: details ? JSON.stringify(details) : null,
      },
    })
  } catch {
    // best-effort
  }
}

// ----------------------------------------------------------------- Plan Limits

/**
 * Enforce plan limits for a tenant. Returns `null` if allowed, otherwise
 * returns a 402 NextResponse with a friendly upgrade message.
 */
export async function enforcePlanLimit(
  restaurantId: string,
  limitKey: 'maxTables' | 'maxMenuItems' | 'maxStaff' | 'maxBranches' | 'maxCategories',
  incrementBy = 1,
): Promise<NextResponse | null> {
  const { db } = await import('@/lib/db')
  const { checkLimit, getPlan } = await import('@/lib/plans')
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { plan: true, subscriptionStatus: true, suspendedAt: true, trialEndsAt: true },
  })
  if (!restaurant) {
    return fail('Restaurant not found.', 404)
  }

  // Check suspension / trial expiry
  if (restaurant.suspendedAt) {
    return NextResponse.json(
      {
        success: false,
        error: 'Your account is suspended. Contact support to reactivate.',
        code: 'SUSPENDED',
      },
      { status: 402 },
    )
  }
  if (
    restaurant.plan === 'TRIAL' &&
    restaurant.trialEndsAt &&
    new Date(restaurant.trialEndsAt).getTime() < Date.now()
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Your trial has expired. Upgrade your plan to continue.',
        code: 'TRIAL_EXPIRED',
      },
      { status: 402 },
    )
  }

  // Count current usage
  let currentCount = 0
  switch (limitKey) {
    case 'maxTables':
      currentCount = await db.table.count({ where: { restaurantId } })
      break
    case 'maxMenuItems':
      currentCount = await db.menuItem.count({ where: { restaurantId } })
      break
    case 'maxStaff':
      currentCount = await db.user.count({
        where: {
          restaurantId,
          role: { not: 'SUPER_ADMIN' },
        },
      })
      break
    case 'maxBranches':
      currentCount = await db.branch.count({ where: { restaurantId } })
      break
    case 'maxCategories':
      currentCount = await db.menuCategory.count({ where: { restaurantId } })
      break
  }

  const plan = getPlan(restaurant.plan)
  const limit = plan.limits[limitKey]
  if (limit !== null && currentCount + incrementBy > limit) {
    return NextResponse.json(
      {
        success: false,
        error: `You've reached the ${plan.name} plan limit of ${limit} ${limitKey.replace('max', '').toLowerCase()}. Please upgrade to add more.`,
        code: 'PLAN_LIMIT_EXCEEDED',
        limit,
        current: currentCount,
        plan: restaurant.plan,
      },
      { status: 402 },
    )
  }

  return null
}
