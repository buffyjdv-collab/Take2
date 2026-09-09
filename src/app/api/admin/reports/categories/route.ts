import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'
import { resolveDateRange } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * Category Report — revenue per category with percentage of total.
 * Example:
 *   Biryani       ₹1,85,000   38%
 *   Main Course   ₹1,20,000   25%
 *   Starters      ₹82,000     17%
 *
 * Platform fee is pro-rated per item based on the item's revenue share of its
 * order's subtotal, then aggregated per category.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('reports.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  // Branch-scoped staff (branch managers) see only their branch's numbers.
  const branchId = scopeBranchId(user)

  const sp = req.nextUrl.searchParams
  const range = sp.get('range') || '7d'
  let dateRange
  try {
    dateRange = resolveDateRange(range, sp.get('from'), sp.get('to'))
  } catch (e: any) {
    return fail(e.message, 400)
  }

  const orderWhere = {
    ...(restaurantId ? { restaurantId } : {}),
    ...(branchId ? { branchId } : {}),
    placedAt: { gte: dateRange.from, lte: dateRange.to },
    status: { not: 'CANCELLED' },
  }

  const [itemRows, allCategories] = await Promise.all([
    db.orderItem.findMany({
      where: { order: orderWhere },
      select: {
        quantity: true,
        totalPrice: true,
        order: { select: { platformFeeAmount: true, subtotal: true } },
        menuItem: {
          select: {
            categoryId: true,
            category: { select: { id: true, name: true, icon: true } },
          },
        },
      },
    }),
    db.menuCategory.findMany({
      where: restaurantId ? { restaurantId } : {},
      select: { id: true, name: true, icon: true },
    }),
  ])

  // Aggregate by category
  const catMap = new Map<
    string,
    {
      categoryId: string
      name: string
      icon: string | null
      quantity: number
      revenue: number
      orderCount: number
      platformFee: number  // pro-rated platform fee for this category
    }
  >()

  // Track unique orders per category for orderCount
  const catOrderIds = new Map<string, Set<string>>()

  // Initialize all categories (so empty ones show as zero)
  for (const c of allCategories) {
    catMap.set(c.id, {
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      quantity: 0,
      revenue: 0,
      orderCount: 0,
      platformFee: 0,
    })
    catOrderIds.set(c.id, new Set())
  }

  for (const it of itemRows) {
    const catId = it.menuItem?.categoryId
    if (!catId) continue
    // Pro-rate the order's platform fee across items based on revenue share
    const itemFee =
      it.order.subtotal > 0
        ? (it.totalPrice / it.order.subtotal) * it.order.platformFeeAmount
        : 0
    const cur = catMap.get(catId)
    if (!cur) {
      // category may have been deleted; use name from menuItem
      catMap.set(catId, {
        categoryId: catId,
        name: it.menuItem?.category?.name || 'Uncategorised',
        icon: it.menuItem?.category?.icon || null,
        quantity: it.quantity,
        revenue: it.totalPrice,
        orderCount: 1,
        platformFee: itemFee,
      })
      catOrderIds.set(catId, new Set())
    } else {
      cur.quantity += it.quantity
      cur.revenue += it.totalPrice
      cur.platformFee += itemFee
    }
  }

  const totalRevenue = Array.from(catMap.values()).reduce((s, c) => s + c.revenue, 0)
  const totalPlatformFee = Array.from(catMap.values()).reduce((s, c) => s + c.platformFee, 0)

  const categories = Array.from(catMap.values())
    .map((c) => ({
      ...c,
      revenue: +c.revenue.toFixed(2),
      platformFee: +c.platformFee.toFixed(2),
      percentage: totalRevenue > 0 ? +((c.revenue / totalRevenue) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return ok({
    range: dateRange.label,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
    categories,
    totalRevenue: +totalRevenue.toFixed(2),
    totalPlatformFee: +totalPlatformFee.toFixed(2),
    totalQuantity: categories.reduce((s, c) => s + c.quantity, 0),
  })
}
