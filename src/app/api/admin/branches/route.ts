import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  fail,
  ok,
  scopeRestaurantId,
  scopeBranchId,
  writeAudit,
  enforcePlanLimit,
  unauthorized,
  forbidden,
} from '@/lib/api-helpers'
import { hasPermissionAsync } from '@/lib/auth'
import { branchSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/branches
 *
 * List all branches of the caller's restaurant with per-branch monitoring
 * stats (sales, orders, top products) so the owner can compare locations at
 * a glance.
 *
 * Read access is intentionally broader than write access: the Tables and
 * Staff managers need the branch list to populate their branch selectors,
 * so any role that can manage tables or staff may read. Mutating is
 * `branches.manage` only (owner / super admin).
 */
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return unauthorized()

  const canRead =
    (await hasPermissionAsync(user.role as string, 'branches.manage')) ||
    (await hasPermissionAsync(user.role as string, 'tables.manage')) ||
    (await hasPermissionAsync(user.role as string, 'staff.manage'))
  if (!canRead) return forbidden('You do not have permission to view branches.')

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) return ok({ branches: [], unassigned: null, totals: null })

  // Branch-scoped staff (e.g. a branch manager opening the Tables page) only
  // ever need their own branch — restrict the list to it. Owners & super
  // admins are never branch-scoped (scopeBranchId returns null for them),
  // even if their user record references a branch.
  const branchScope = scopeBranchId(user)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 6) // 7 calendar days incl. today

  const orderBase = {
    restaurantId,
    placedAt: { gte: weekStart },
    status: { not: 'CANCELLED' },
  }

  const [branches, weekOrders, weekItems] = await Promise.all([
    db.branch.findMany({
      where: { restaurantId, ...(branchScope ? { id: branchScope } : {}) },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { tables: true } },
        users: {
          select: { id: true, name: true, email: true, role: true, active: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    db.order.findMany({
      where: orderBase,
      select: { branchId: true, grandTotal: true, placedAt: true },
    }),
    db.orderItem.findMany({
      where: { order: orderBase },
      select: {
        order: { select: { branchId: true } },
        menuItemId: true,
        menuItemName: true,
        quantity: true,
        totalPrice: true,
      },
    }),
  ])

  interface Stat {
    todayOrders: number
    todayRevenue: number
    weekOrders: number
    weekRevenue: number
  }
  const emptyStat = (): Stat => ({
    todayOrders: 0,
    todayRevenue: 0,
    weekOrders: 0,
    weekRevenue: 0,
  })

  // Aggregate order stats per branch + an "unassigned" bucket for orders whose
  // table has no branch (legacy QR cards placed before branching existed).
  const stats = new Map<string, Stat>() // key: branchId or '__unassigned__'
  const bump = (key: string, total: number, placedAt: Date) => {
    const s = stats.get(key) || emptyStat()
    s.weekOrders += 1
    s.weekRevenue += total
    if (placedAt >= today) {
      s.todayOrders += 1
      s.todayRevenue += total
    }
    stats.set(key, s)
  }
  for (const o of weekOrders) bump(o.branchId || '__unassigned__', o.grandTotal, o.placedAt)

  // Top products (by quantity, 7 days) per branch
  const items = new Map<string, Map<string, { name: string; quantity: number; revenue: number }>>()
  for (const it of weekItems) {
    const key = it.order.branchId || '__unassigned__'
    const perBranch = items.get(key) || new Map()
    const cur = perBranch.get(it.menuItemId) || {
      name: it.menuItemName,
      quantity: 0,
      revenue: 0,
    }
    cur.quantity += it.quantity
    cur.revenue += it.totalPrice
    perBranch.set(it.menuItemId, cur)
    items.set(key, perBranch)
  }
  const topItemsFor = (key: string) => {
    const perBranch = items.get(key)
    if (!perBranch) return []
    return Array.from(perBranch.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
  }

  const shaped = branches.map((b) => {
    const s = stats.get(b.id) || emptyStat()
    return {
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      active: b.active,
      createdAt: b.createdAt,
      tableCount: b._count.tables,
      users: b.users,
      stats: {
        todayOrders: s.todayOrders,
        todayRevenue: +s.todayRevenue.toFixed(2),
        weekOrders: s.weekOrders,
        weekRevenue: +s.weekRevenue.toFixed(2),
        topItems: topItemsFor(b.id),
      },
    }
  })

  // Orders whose table has no branch — shown as "Unassigned" so the owner can
  // spot QR codes that still need to be attached to a location.
  const unassignedStat = stats.get('__unassigned__')
  const unassigned = unassignedStat
    ? {
        todayOrders: unassignedStat.todayOrders,
        todayRevenue: +unassignedStat.todayRevenue.toFixed(2),
        weekOrders: unassignedStat.weekOrders,
        weekRevenue: +unassignedStat.weekRevenue.toFixed(2),
        topItems: topItemsFor('__unassigned__'),
      }
    : null

  const totals = shaped.reduce(
    (acc, b) => ({
      todayOrders: acc.todayOrders + b.stats.todayOrders,
      todayRevenue: +(acc.todayRevenue + b.stats.todayRevenue).toFixed(2),
      weekOrders: acc.weekOrders + b.stats.weekOrders,
      weekRevenue: +(acc.weekRevenue + b.stats.weekRevenue).toFixed(2),
    }),
    { todayOrders: 0, todayRevenue: 0, weekOrders: 0, weekRevenue: 0 },
  )
  if (unassigned) {
    totals.todayOrders += unassigned.todayOrders
    totals.todayRevenue = +(totals.todayRevenue + unassigned.todayRevenue).toFixed(2)
    totals.weekOrders += unassigned.weekOrders
    totals.weekRevenue = +(totals.weekRevenue + unassigned.weekRevenue).toFixed(2)
  }

  return ok({ branches: shaped, unassigned, totals })
}

/**
 * POST /api/admin/branches — create a branch (owner / super admin).
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return unauthorized()

  const allowed = await hasPermissionAsync(user.role as string, 'branches.manage')
  if (!allowed) return forbidden('Only the restaurant owner can create branches.')

  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }

  const restaurantId = scopeRestaurantId(user, body?.restaurantId)
  if (!restaurantId) return fail('Restaurant is required.', 400)

  const parsed = branchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }

  const limitErr = await enforcePlanLimit(restaurantId, 'maxBranches')
  if (limitErr) return limitErr

  const branch = await db.branch.create({
    data: {
      restaurantId,
      name: parsed.data.name.trim(),
      address: parsed.data.address.trim(),
      phone: parsed.data.phone?.trim() || null,
      active: parsed.data.active ?? true,
    },
  })

  writeAudit(user, 'CREATE', 'BRANCH', branch.id, { name: branch.name })
  return ok(branch, 201)
}
