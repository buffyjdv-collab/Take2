import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'
import { resolveDateRange } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * Product Report — shows what is actually selling.
 * Columns: Item | Qty | Gross Sales | Discount | Net Sales | Platform Fee
 * Includes Top Selling (by qty) and Top Revenue (by revenue) rankings.
 *
 * Platform fee is pro-rated per item based on the item's revenue share of its
 * order's subtotal: (item.totalPrice / order.subtotal) * order.platformFeeAmount
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

  const itemRows = await db.orderItem.findMany({
    where: { order: orderWhere },
    select: {
      menuItemId: true,
      menuItemName: true,
      quantity: true,
      totalPrice: true,
      basePrice: true,
      variantPrice: true,
      modifiersTotal: true,
      order: { select: { platformFeeAmount: true, subtotal: true } },
      menuItem: {
        select: {
          isVeg: true,
          isSpicy: true,
          image: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Aggregate by menuItemId
  const itemAgg = new Map<
    string,
    {
      menuItemId: string
      name: string
      image: string | null
      isVeg: boolean
      isSpicy: boolean
      categoryName: string | null
      quantity: number
      grossSales: number
      discount: number  // per-item discount (pro-rated if order had discount)
      netSales: number
      platformFee: number  // pro-rated platform fee for this item
    }
  >()

  for (const it of itemRows) {
    // Pro-rate the order's platform fee across items based on revenue share
    const itemFee =
      it.order.subtotal > 0
        ? (it.totalPrice / it.order.subtotal) * it.order.platformFeeAmount
        : 0
    const cur = itemAgg.get(it.menuItemId) || {
      menuItemId: it.menuItemId,
      name: it.menuItemName,
      image: it.menuItem?.image || null,
      isVeg: it.menuItem?.isVeg ?? true,
      isSpicy: it.menuItem?.isSpicy ?? false,
      categoryName: it.menuItem?.category?.name || null,
      quantity: 0,
      grossSales: 0,
      discount: 0,
      netSales: 0,
      platformFee: 0,
    }
    cur.quantity += it.quantity
    cur.grossSales += it.totalPrice
    cur.netSales += it.totalPrice // no per-item discount tracking yet; net = gross for items
    cur.platformFee += itemFee
    itemAgg.set(it.menuItemId, cur)
  }

  const all = Array.from(itemAgg.values()).map((v) => ({
    ...v,
    grossSales: +v.grossSales.toFixed(2),
    discount: +v.discount.toFixed(2),
    netSales: +v.netSales.toFixed(2),
    platformFee: +v.platformFee.toFixed(2),
  }))

  // Top Selling (by quantity)
  const topSelling = [...all].sort((a, b) => b.quantity - a.quantity).slice(0, 10)
  // Top Revenue (by net sales)
  const topRevenue = [...all].sort((a, b) => b.netSales - a.netSales).slice(0, 10)
  // Full list sorted by quantity desc
  const items = [...all].sort((a, b) => b.quantity - a.quantity || b.netSales - a.netSales)

  const summary = {
    totalItems: all.length,
    totalQuantity: all.reduce((s, i) => s + i.quantity, 0),
    totalGrossSales: +all.reduce((s, i) => s + i.grossSales, 0).toFixed(2),
    totalDiscount: +all.reduce((s, i) => s + i.discount, 0).toFixed(2),
    totalNetSales: +all.reduce((s, i) => s + i.netSales, 0).toFixed(2),
    totalPlatformFee: +all.reduce((s, i) => s + i.platformFee, 0).toFixed(2),
  }

  return ok({
    range: dateRange.label,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
    items,
    topSelling,
    topRevenue,
    summary,
  })
}
