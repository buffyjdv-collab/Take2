import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/** Platform-wide KPIs across all tenants. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    requireSuperAdmin(session)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [
    totalRestaurants,
    activeRestaurants,
    suspendedRestaurants,
    trialingRestaurants,
    todayOrders,
    last30DaysOrders,
    totalUsers,
    totalTables,
    paidOrdersLast30,
  ] = await Promise.all([
    db.restaurant.count(),
    db.restaurant.count({ where: { subscriptionStatus: 'ACTIVE' } }),
    db.restaurant.count({ where: { subscriptionStatus: 'SUSPENDED' } }),
    db.restaurant.count({ where: { subscriptionStatus: 'TRIALING' } }),
    db.order.count({ where: { placedAt: { gte: startOfToday } } }),
    db.order.count({ where: { placedAt: { gte: last30Days } } }),
    db.user.count(),
    db.table.count(),
    db.order.findMany({
      where: {
        placedAt: { gte: last30Days },
        paymentStatus: 'PAID',
      },
      select: { grandTotal: true, restaurantId: true, placedAt: true, paymentMethod: true },
    }),
  ])

  const grossMerchandiseVolume = paidOrdersLast30.reduce((sum, o) => sum + o.grandTotal, 0)

  // Revenue per plan
  const planCounts = await db.restaurant.groupBy({
    by: ['plan'],
    _count: { _all: true },
  })

  // Top 10 tenants by revenue (last 30 days)
  const topTenantsMap = new Map<string, number>()
  for (const o of paidOrdersLast30) {
    topTenantsMap.set(o.restaurantId, (topTenantsMap.get(o.restaurantId) || 0) + o.grandTotal)
  }
  const topTenantIds = [...topTenantsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id)
  const topTenants = topTenantIds.length
    ? await db.restaurant.findMany({
        where: { id: { in: topTenantIds } },
        select: { id: true, name: true, slug: true, plan: true, city: true },
      })
    : []
  const topTenantsWithRevenue = topTenants.map((t) => ({
    ...t,
    revenue: topTenantsMap.get(t.id) || 0,
  }))

  // Last 14 days trend: orders per day
  const days14: { date: string; orders: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const start = new Date(now)
    start.setDate(now.getDate() - i)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 1)
    const count = await db.order.count({
      where: { placedAt: { gte: start, lt: end } },
    })
    days14.push({ date: start.toISOString().slice(0, 10), orders: count })
  }

  // Payment method breakdown (last 30 days)
  const paymentMethods: Record<string, number> = {}
  for (const o of paidOrdersLast30) {
    const m = o.paymentMethod || 'UNKNOWN'
    paymentMethods[m] = (paymentMethods[m] || 0) + 1
  }

  return NextResponse.json({
    success: true,
    data: {
      tenants: {
        total: totalRestaurants,
        active: activeRestaurants,
        suspended: suspendedRestaurants,
        trialing: trialingRestaurants,
        byPlan: planCounts.reduce((acc, p) => {
          acc[p.plan] = p._count._all
          return acc
        }, {} as Record<string, number>),
      },
      orders: {
        today: todayOrders,
        last30Days: last30DaysOrders,
      },
      revenue: {
        gmvLast30Days: grossMerchandiseVolume,
        // Platform commission (if configured) would be a percentage of GMV
      },
      users: {
        total: totalUsers,
      },
      tables: { total: totalTables },
      trends: {
        ordersLast14Days: days14,
      },
      topTenants: topTenantsWithRevenue,
      paymentMethodBreakdown: paymentMethods,
      generatedAt: now.toISOString(),
    },
  })
}
