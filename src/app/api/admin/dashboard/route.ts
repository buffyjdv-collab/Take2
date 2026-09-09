import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/dashboard
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(
    user,
    req.nextUrl.searchParams.get('restaurantId'),
  )
  // Branch-scoped staff (e.g. a branch manager) see only their branch's numbers.
  const branchId = scopeBranchId(user)
  const branchFilter = branchId ? { branchId } : {}

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const orderWhere = {
    ...(restaurantId ? { restaurantId } : {}),
    ...branchFilter,
    placedAt: { gte: today, lt: tomorrow },
    status: { not: 'CANCELLED' },
  }

  const [
    todayOrders,
    statusCountsRaw,
    last7DayOrders,
    topItemsRaw,
  ] = await Promise.all([
    db.order.findMany({
      where: orderWhere,
      select: {
        grandTotal: true,
        status: true,
        paymentStatus: true,
        orderNumber: true,
        id: true,
        tableId: true,
        placedAt: true,
        table: { select: { number: true } },
        items: { select: { quantity: true, menuItemName: true, menuItemId: true } },
      },
    }),
    db.order.groupBy({
      by: ['status'],
      where: {
        ...(restaurantId ? { restaurantId } : {}),
        ...branchFilter,
        placedAt: { gte: today, lt: tomorrow },
      },
      _count: true,
    }),
    db.order.findMany({
      where: {
        ...(restaurantId ? { restaurantId } : {}),
        ...branchFilter,
        placedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        status: { not: 'CANCELLED' },
      },
      select: { grandTotal: true, placedAt: true },
    }),
    db.orderItem.findMany({
      where: {
        order: {
          ...(restaurantId ? { restaurantId } : {}),
          ...branchFilter,
          placedAt: { gte: today, lt: tomorrow },
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        menuItemId: true,
        menuItemName: true,
        quantity: true,
        totalPrice: true,
      },
    }),
  ])

  const todaySales = todayOrders.reduce((s, o) => s + o.grandTotal, 0)
  const todayOrderCount = todayOrders.length
  const aov = todayOrderCount > 0 ? todaySales / todayOrderCount : 0

  const statusCounts: Record<string, number> = {
    NEW: 0,
    ACCEPTED: 0,
    PREPARING: 0,
    READY: 0,
    SERVED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  }
  for (const r of statusCountsRaw) statusCounts[r.status] = r._count

  // 7-day revenue
  const days: Array<{ date: string; revenue: number; orders: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const start = d
    const end = new Date(d)
    end.setDate(end.getDate() + 1)
    const dayOrders = last7DayOrders.filter(
      (o) => o.placedAt >= start && o.placedAt < end,
    )
    days.push({
      date: d.toISOString().slice(0, 10),
      revenue: +dayOrders.reduce((s, o) => s + o.grandTotal, 0).toFixed(2),
      orders: dayOrders.length,
    })
  }

  // Top 5 items
  const itemAgg = new Map<
    string,
    { name: string; quantity: number; revenue: number }
  >()
  for (const it of topItemsRaw) {
    const cur = itemAgg.get(it.menuItemId) || {
      name: it.menuItemName,
      quantity: 0,
      revenue: 0,
    }
    cur.quantity += it.quantity
    cur.revenue += it.totalPrice
    itemAgg.set(it.menuItemId, cur)
  }
  const topItems = Array.from(itemAgg.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)

  // Recent orders (last 5)
  const recentOrders = todayOrders
    .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
    .slice(0, 5)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      tableNumber: o.table?.number,
      placedAt: o.placedAt,
      status: o.status,
      paymentStatus: o.paymentStatus,
      grandTotal: o.grandTotal,
      itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
    }))

  return ok({
    todaySales: +todaySales.toFixed(2),
    todayOrderCount,
    aov: +aov.toFixed(2),
    statusCounts,
    days,
    topItems,
    recentOrders,
  })
}
