import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reports/network
 *
 * RESTAURANT_OWNER's cross-branch consolidated reporting — sales, revenue,
 * product performance and platform fee for ALL branches, grouped day-wise or
 * month-wise, with a per-branch breakdown inside every period and for the
 * whole range. Sorting happens client-side (all rows are returned).
 *
 * Only owners & super admins reach this endpoint — branch managers are
 * limited to their own branch in /api/admin/reports*.
 *
 * Query params:
 *   from, to   — ISO dates (required together; defaults to last 30 days)
 *   groupBy    — 'day' (default) | 'month'
 *   branchId   — 'all' (default) or a single branch id
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('reports.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  // Owner-only: branch-scoped roles must use their own scoped reports.
  if (user.role !== 'RESTAURANT_OWNER' && user.role !== 'SUPER_ADMIN') {
    return fail('Only the restaurant owner can view network reports.', 403)
  }
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return ok({ from: null, to: null, groupBy: 'day', summary: null, branches: [], periods: [], products: [] })
  }

  const sp = req.nextUrl.searchParams
  const groupBy = sp.get('groupBy') === 'month' ? 'month' : 'day'
  const branchFilter = sp.get('branchId') || 'all'

  let from: Date
  let to: Date = new Date()
  const f = sp.get('from')
  const t = sp.get('to')
  if (f && t) {
    from = new Date(f)
    to = new Date(t)
    to.setHours(23, 59, 59, 999)
  } else {
    from = new Date()
    from.setDate(from.getDate() - 29)
    from.setHours(0, 0, 0, 0)
  }
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return fail('Invalid date range.', 400)
  }

  const orderWhere = {
    restaurantId,
    placedAt: { gte: from, lte: to },
    status: { not: 'CANCELLED' },
    // 'all' → every branch (+ unassigned); otherwise a single branch.
    ...(branchFilter !== 'all' ? { branchId: branchFilter } : {}),
  }

  const [orders, itemsWithOrder, orderIds, branches] = await Promise.all([
    db.order.findMany({
      where: orderWhere,
      select: {
        placedAt: true,
        grandTotal: true,
        netTotal: true,
        status: true,
        branchId: true,
        platformFeeAmount: true,
      },
    }),
    db.orderItem.findMany({
      where: { order: orderWhere },
      select: {
        orderId: true,
        menuItemId: true,
        menuItemName: true,
        quantity: true,
        totalPrice: true,
        order: { select: { branchId: true } },
      },
    }),
    db.order.findMany({
      where: orderWhere,
      select: { id: true, placedAt: true },
    }),
    db.branch.findMany({
      where: { restaurantId },
      select: { id: true, name: true },
    }),
  ])

  const branchNames = new Map(branches.map((b) => [b.id, b.name]))
  const branchNameOf = (id: string | null) =>
    id ? branchNames.get(id) || 'Unknown branch' : 'Unassigned'

  // ---------------------------------------------------------------- periods
  interface PeriodBranch {
    branchId: string | null
    branchName: string
    orders: number
    revenue: number
    netRevenue: number
    platformFee: number
  }
  interface Period {
    key: string
    label: string
    orders: number
    revenue: number
    netRevenue: number
    platformFee: number
    branches: PeriodBranch[]
    topProducts: Array<{ id: string; name: string; qty: number; revenue: number }>
  }

  const periods = new Map<
    string,
    Period & { _branchMap: Map<string, PeriodBranch>; _prodMap: Map<string, { id: string; name: string; qty: number; revenue: number }> }
  >()

  const periodKeyOf = (d: Date) => {
    if (groupBy === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    const day = new Date(d)
    day.setHours(0, 0, 0, 0)
    return day.toISOString().slice(0, 10)
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const periodLabelOf = (key: string) => {
    if (groupBy === 'month') {
      const [y, m] = key.split('-').map(Number)
      return `${monthNames[m - 1]} ${y}`
    }
    return key
  }

  const getPeriod = (key: string) => {
    let p = periods.get(key)
    if (!p) {
      p = {
        key,
        label: periodLabelOf(key),
        orders: 0,
        revenue: 0,
        netRevenue: 0,
        platformFee: 0,
        branches: [],
        topProducts: [],
        _branchMap: new Map(),
        _prodMap: new Map(),
      }
      periods.set(key, p)
    }
    return p
  }

  const getPeriodBranch = (p: ReturnType<typeof getPeriod>, branchId: string | null) => {
    let b = p._branchMap.get(branchId || '__unassigned__')
    if (!b) {
      b = {
        branchId,
        branchName: branchNameOf(branchId),
        orders: 0,
        revenue: 0,
        netRevenue: 0,
        platformFee: 0,
      }
      p._branchMap.set(branchId || '__unassigned__', b)
    }
    return b
  }

  for (const o of orders) {
    const p = getPeriod(periodKeyOf(new Date(o.placedAt)))
    const b = getPeriodBranch(p, o.branchId)
    p.orders += 1
    p.revenue += o.grandTotal
    p.netRevenue += o.netTotal
    p.platformFee += o.platformFeeAmount
    b.orders += 1
    b.revenue += o.grandTotal
    b.netRevenue += o.netTotal
    b.platformFee += o.platformFeeAmount
  }

  // ------------------------------------------------------- product sales
  interface ProductRow {
    id: string
    name: string
    branchId: string | null
    branchName: string
    qty: number
    revenue: number
  }
  const productAgg = new Map<string, ProductRow>()
  const orderPlacedAt = new Map<string, Date>()
  for (const o of orderIds) orderPlacedAt.set(o.id, new Date(o.placedAt))

  for (const it of itemsWithOrder) {
    // range-wide product rows (branch-attributed, sortable client-side)
    const branchId = it.order.branchId
    const key = `${it.menuItemId}::${branchId || 'unassigned'}`
    const cur =
      productAgg.get(key) ||
      {
        id: it.menuItemId,
        name: it.menuItemName,
        branchId,
        branchName: branchNameOf(branchId),
        qty: 0,
        revenue: 0,
      }
    cur.qty += it.quantity
    cur.revenue += it.totalPrice
    productAgg.set(key, cur)

    // per-period top products
    const placed = orderPlacedAt.get(it.orderId)
    if (!placed) continue
    const p = getPeriod(periodKeyOf(placed))
    const prod = p._prodMap.get(it.menuItemId) ||
      { id: it.menuItemId, name: it.menuItemName, qty: 0, revenue: 0 }
    prod.qty += it.quantity
    prod.revenue += it.totalPrice
    p._prodMap.set(it.menuItemId, prod)
  }

  const periodRows = Array.from(periods.values())
    .map((p) => {
      const { _branchMap, _prodMap, ...rest } = p
      void _branchMap
      rest.branches = Array.from(p._branchMap.values()).map((b) => ({
        ...b,
        revenue: +b.revenue.toFixed(2),
        netRevenue: +b.netRevenue.toFixed(2),
        platformFee: +b.platformFee.toFixed(2),
      }))
      rest.topProducts = Array.from(p._prodMap.values())
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)
        .map((x) => ({ ...x, revenue: +x.revenue.toFixed(2) }))
      return {
        ...rest,
        revenue: +rest.revenue.toFixed(2),
        netRevenue: +rest.netRevenue.toFixed(2),
        platformFee: +rest.platformFee.toFixed(2),
      }
    })
    .sort((a, b) => (a.key < b.key ? 1 : -1)) // newest period first

  // ------------------------------------------------------- branch totals
  const branchTotalsMap = new Map<
    string,
    { branchId: string | null; branchName: string; orders: number; revenue: number; netRevenue: number; platformFee: number }
  >()
  for (const o of orders) {
    const key = o.branchId || '__unassigned__'
    const cur =
      branchTotalsMap.get(key) ||
      {
        branchId: o.branchId,
        branchName: branchNameOf(o.branchId),
        orders: 0,
        revenue: 0,
        netRevenue: 0,
        platformFee: 0,
      }
    cur.orders += 1
    cur.revenue += o.grandTotal
    cur.netRevenue += o.netTotal
    cur.platformFee += o.platformFeeAmount
    branchTotalsMap.set(key, cur)
  }
  const totalRevenue = orders.reduce((s, o) => s + o.grandTotal, 0)
  const branchTotals = Array.from(branchTotalsMap.values())
    .map((b) => ({
      ...b,
      revenue: +b.revenue.toFixed(2),
      netRevenue: +b.netRevenue.toFixed(2),
      platformFee: +b.platformFee.toFixed(2),
      aov: b.orders > 0 ? +(b.revenue / b.orders).toFixed(2) : 0,
      share: totalRevenue > 0 ? +((b.revenue / totalRevenue) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const productRows = Array.from(productAgg.values()).map((p) => ({
    ...p,
    revenue: +p.revenue.toFixed(2),
  }))

  const totalOrders = orders.length
  const summary = {
    orders: totalOrders,
    revenue: +totalRevenue.toFixed(2),
    netRevenue: +orders.reduce((s, o) => s + o.netTotal, 0).toFixed(2),
    platformFee: +orders.reduce((s, o) => s + o.platformFeeAmount, 0).toFixed(2),
    aov: totalOrders > 0 ? +(totalRevenue / totalOrders).toFixed(2) : 0,
    unitsSold: itemsWithOrder.reduce((s, i) => s + i.quantity, 0),
    branchCount: branchTotals.filter((b) => b.branchId).length,
  }

  return ok({
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy,
    branchFilter,
    summary,
    branches: branchTotals,
    periods: periodRows,
    products: productRows,
  })
}
