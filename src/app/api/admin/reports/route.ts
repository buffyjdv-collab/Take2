import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/reports?range=today|7d|30d|custom&from=&to=
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('reports.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  // Branch-scoped staff (branch managers) see only their branch's numbers.
  const branchId = scopeBranchId(user)

  const sp = req.nextUrl.searchParams
  const range = sp.get('range') || '7d'
  let from: Date
  let to = new Date()
  const now = new Date()
  if (range === 'today') {
    from = new Date()
    from.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    from = new Date()
    from.setDate(now.getDate() - 6)
    from.setHours(0, 0, 0, 0)
  } else if (range === '30d') {
    from = new Date()
    from.setDate(now.getDate() - 29)
    from.setHours(0, 0, 0, 0)
  } else if (range === 'custom') {
    const f = sp.get('from')
    const t = sp.get('to')
    if (!f || !t) return fail('Custom range requires from & to.', 400)
    from = new Date(f)
    to = new Date(t)
    to.setHours(23, 59, 59, 999)
  } else {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  const where = {
    ...(restaurantId ? { restaurantId } : {}),
    ...(branchId ? { branchId } : {}),
    placedAt: { gte: from, lte: to },
  }
  const activeWhere = { ...where, status: { not: 'CANCELLED' } }

  const [
    orders,
    cancelledOrdersCount,
    itemRows,
    categoryRows,
    paymentRows,
    hourlyAgg,
  ] = await Promise.all([
    db.order.findMany({
      where: activeWhere,
      select: {
        grandTotal: true,
        subtotal: true,
        taxAmount: true,
        serviceCharge: true,
        discountAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        placedAt: true,
        status: true,
      },
    }),
    db.order.count({ where: { ...where, status: 'CANCELLED' } }),
    db.orderItem.findMany({
      where: {
        order: { ...activeWhere },
      },
      select: {
        menuItemId: true,
        menuItemName: true,
        quantity: true,
        totalPrice: true,
        menuItem: { select: { category: { select: { id: true, name: true } } } },
      },
    }),
    db.menuCategory.findMany({
      where: restaurantId ? { restaurantId } : {},
      select: { id: true, name: true },
    }),
    db.payment.findMany({
      where: {
        order: activeWhere,
        status: 'PAID',
      },
      select: { method: true, amount: true },
    }),
    db.order.findMany({
      where: activeWhere,
      select: { placedAt: true },
    }),
  ])

  const totalSales = orders.reduce((s, o) => s + o.grandTotal, 0)
  const orderCount = orders.length
  const aov = orderCount > 0 ? totalSales / orderCount : 0
  const taxCollected = orders.reduce((s, o) => s + o.taxAmount, 0)

  // Best-selling items
  const itemAgg = new Map<
    string,
    { name: string; quantity: number; revenue: number }
  >()
  for (const it of itemRows) {
    const cur = itemAgg.get(it.menuItemId) || {
      name: it.menuItemName,
      quantity: 0,
      revenue: 0,
    }
    cur.quantity += it.quantity
    cur.revenue += it.totalPrice
    itemAgg.set(it.menuItemId, cur)
  }
  const bestSellingItems = Array.from(itemAgg.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // Category sales
  const catMap = new Map<string, number>()
  for (const it of itemRows) {
    const catId = it.menuItem?.category?.id
    const catName = it.menuItem?.category?.name || 'Uncategorised'
    if (!catId) continue
    catMap.set(catName, (catMap.get(catName) || 0) + it.totalPrice)
  }
  const categorySales = Array.from(catMap.entries())
    .map(([name, revenue]) => ({ name, revenue: +revenue.toFixed(2) }))
    .sort((a, b) => b.revenue - a.revenue)

  // Payment method breakdown
  const methodTotals: Record<string, number> = {
    UPI: 0,
    CARD: 0,
    CASH: 0,
    COUNTER: 0,
    WALLET: 0,
  }
  for (const p of paymentRows) {
    methodTotals[p.method] = (methodTotals[p.method] || 0) + p.amount
  }
  // Counter = orders paid COUNTER method (treated separately)
  const paymentMethodBreakdown = Object.entries(methodTotals).map(([k, v]) => ({
    method: k,
    total: +v.toFixed(2),
  }))

  // Peak hours — 24 buckets
  const peakHours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    orders: 0,
  }))
  for (const o of hourlyAgg) {
    const h = new Date(o.placedAt).getHours()
    peakHours[h].orders += 1
  }

  // Daily trend
  const days: Array<{ date: string; revenue: number; orders: number }> = []
  const dayMap = new Map<string, { revenue: number; orders: number }>()
  for (const o of orders) {
    const d = new Date(o.placedAt)
    d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    const cur = dayMap.get(key) || { revenue: 0, orders: 0 }
    cur.revenue += o.grandTotal
    cur.orders += 1
    dayMap.set(key, cur)
  }
  // Fill missing days
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 10)
    const v = dayMap.get(key) || { revenue: 0, orders: 0 }
    days.push({ date: key, revenue: +v.revenue.toFixed(2), orders: v.orders })
    cursor.setDate(cursor.getDate() + 1)
  }

  return ok({
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totalSales: +totalSales.toFixed(2),
    orderCount,
    aov: +aov.toFixed(2),
    taxCollected: +taxCollected.toFixed(2),
    cancelledOrdersCount,
    bestSellingItems,
    categorySales,
    paymentMethodBreakdown,
    peakHours,
    days,
  })
}
