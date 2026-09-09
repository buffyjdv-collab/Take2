import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'
import { resolveDateRange, enumerateDays } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * Sales Report — main revenue report.
 * Columns per day: Date | Orders | Gross Sales | Discount | Refund | Net Sales | Tax | Platform Fee | Total
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

  const where = {
    ...(restaurantId ? { restaurantId } : {}),
    ...(branchId ? { branchId } : {}),
    placedAt: { gte: dateRange.from, lte: dateRange.to },
  }

  // All orders (including cancelled, since cancelled orders may have refunds)
  const orders = await db.order.findMany({
    where,
    select: {
      placedAt: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      discountAmount: true,
      refundAmount: true,
      taxAmount: true,
      grandTotal: true,
      netTotal: true,
      platformFeeAmount: true,
    },
    orderBy: { placedAt: 'asc' },
  })

  // Group by day
  const dayMap = new Map<
    string,
    {
      date: string
      orders: number
      grossSales: number
      discount: number
      refund: number
      netSales: number
      tax: number
      platformFee: number
      total: number
    }
  >()

  // Initialize all days in range (so empty days show as zero)
  for (const day of enumerateDays(dateRange.from, dateRange.to)) {
    dayMap.set(day, {
      date: day,
      orders: 0,
      grossSales: 0,
      discount: 0,
      refund: 0,
      netSales: 0,
      tax: 0,
      platformFee: 0,
      total: 0,
    })
  }

  for (const o of orders) {
    // Skip cancelled orders that weren't paid (they don't count as sales)
    if (o.status === 'CANCELLED' && o.paymentStatus !== 'PAID') continue
    const d = new Date(o.placedAt)
    d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    const cur = dayMap.get(key)
    if (!cur) continue
    cur.orders += 1
    cur.grossSales += o.subtotal
    cur.discount += o.discountAmount
    cur.refund += o.refundAmount
    cur.netSales += Math.max(0, o.subtotal - o.discountAmount - o.refundAmount)
    cur.tax += o.taxAmount
    cur.platformFee += o.platformFeeAmount
    cur.total += o.grandTotal - o.refundAmount
  }

  const rows = Array.from(dayMap.values()).map((r) => ({
    ...r,
    grossSales: +r.grossSales.toFixed(2),
    discount: +r.discount.toFixed(2),
    refund: +r.refund.toFixed(2),
    netSales: +r.netSales.toFixed(2),
    tax: +r.tax.toFixed(2),
    platformFee: +r.platformFee.toFixed(2),
    total: +r.total.toFixed(2),
  }))

  // Summary totals
  const summary = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      grossSales: acc.grossSales + r.grossSales,
      discount: acc.discount + r.discount,
      refund: acc.refund + r.refund,
      netSales: acc.netSales + r.netSales,
      tax: acc.tax + r.tax,
      platformFee: acc.platformFee + r.platformFee,
      total: acc.total + r.total,
    }),
    { orders: 0, grossSales: 0, discount: 0, refund: 0, netSales: 0, tax: 0, platformFee: 0, total: 0 },
  )

  // Fetch actual PlatformFee records (joined to order so the date range
  // matches the orders shown above). This lets us report the payer breakdown
  // (restaurant portion vs customer portion) and the collection status.
  const platformFees = await db.platformFee.findMany({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      order: {
        placedAt: { gte: dateRange.from, lte: dateRange.to },
        // platformFee has no branchId column — filter through the order.
        ...(branchId ? { branchId } : {}),
      },
    },
    select: {
      feeAmount: true,
      customerPortion: true,
      restaurantPortion: true,
      status: true,
    },
  })

  const platformFeeBreakdown = {
    totalCollected: +platformFees
      .filter((f) => f.status === 'COLLECTED')
      .reduce((s, f) => s + f.feeAmount, 0)
      .toFixed(2),
    totalPending: +platformFees
      .filter((f) => f.status === 'PENDING')
      .reduce((s, f) => s + f.feeAmount, 0)
      .toFixed(2),
    restaurantPortion: +platformFees.reduce((s, f) => s + f.restaurantPortion, 0).toFixed(2),
    customerPortion: +platformFees.reduce((s, f) => s + f.customerPortion, 0).toFixed(2),
  }

  return ok({
    range: dateRange.label,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
    rows,
    platformFeeBreakdown,
    summary: {
      ...summary,
      grossSales: +summary.grossSales.toFixed(2),
      discount: +summary.discount.toFixed(2),
      refund: +summary.refund.toFixed(2),
      netSales: +summary.netSales.toFixed(2),
      tax: +summary.tax.toFixed(2),
      platformFee: +summary.platformFee.toFixed(2),
      total: +summary.total.toFixed(2),
      aov: summary.orders > 0 ? +(summary.total / summary.orders).toFixed(2) : 0,
    },
  })
}
