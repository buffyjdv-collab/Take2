import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId } from '@/lib/api-helpers'
import { resolveDateRange } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * Platform Fee Report — restaurant owner's view of fees collected
 * from their orders within the given date range.
 *
 * Returns:
 *   - totalCollected / totalPending / totalRefunded / totalWaived
 *   - byFeeType: [{ feeType, amount, count }]
 *   - byPayer:   [{ payer, amount, count }]
 *   - restaurantPortion / customerPortion (only for COLLECTED fees)
 *   - recentFees: [{ id, orderNumber, feeType, feeAmount, baseAmount, payer, status, collectedAt, createdAt }]
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('reports.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))

  const sp = req.nextUrl.searchParams
  const range = sp.get('range') || '7d'
  let dateRange
  try {
    dateRange = resolveDateRange(range, sp.get('from'), sp.get('to'))
  } catch (e: any) {
    return fail(e.message, 400)
  }

  // Load all platform-fee records in range for this restaurant.
  // scopeRestaurantId returns null for SUPER_ADMIN without override — same pattern as the other reports.
  const feeWhere = {
    ...(restaurantId ? { restaurantId } : {}),
    createdAt: { gte: dateRange.from, lte: dateRange.to },
  }

  const fees = await db.platformFee.findMany({
    where: feeWhere,
    select: {
      id: true,
      feeType: true,
      baseAmount: true,
      feeAmount: true,
      payer: true,
      customerPortion: true,
      restaurantPortion: true,
      status: true,
      collectedAt: true,
      createdAt: true,
      order: {
        select: { orderNumber: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  // Totals by status
  let totalCollected = 0
  let totalPending = 0
  let totalRefunded = 0
  let totalWaived = 0
  let restaurantPortion = 0
  let customerPortion = 0

  // Breakdown maps
  const feeTypeMap = new Map<string, { amount: number; count: number }>()
  const payerMap = new Map<string, { amount: number; count: number }>()

  for (const f of fees) {
    // Fee type aggregation uses feeAmount across ALL statuses (lifetime volume per type)
    const ft = feeTypeMap.get(f.feeType) || { amount: 0, count: 0 }
    ft.amount += f.feeAmount
    ft.count += 1
    feeTypeMap.set(f.feeType, ft)

    // Payer aggregation also uses feeAmount across all statuses
    const pm = payerMap.get(f.payer) || { amount: 0, count: 0 }
    pm.amount += f.feeAmount
    pm.count += 1
    payerMap.set(f.payer, pm)

    // Status totals
    if (f.status === 'COLLECTED') {
      totalCollected += f.feeAmount
      restaurantPortion += f.restaurantPortion
      customerPortion += f.customerPortion
    } else if (f.status === 'PENDING') {
      totalPending += f.feeAmount
    } else if (f.status === 'REFUNDED') {
      totalRefunded += f.feeAmount
    } else if (f.status === 'WAIVED') {
      totalWaived += f.feeAmount
    }
  }

  const byFeeType = Array.from(feeTypeMap.entries())
    .map(([feeType, v]) => ({
      feeType,
      amount: +v.amount.toFixed(2),
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount)

  const byPayer = Array.from(payerMap.entries())
    .map(([payer, v]) => ({
      payer,
      amount: +v.amount.toFixed(2),
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount)

  const recentFees = fees.slice(0, 20).map((f) => ({
    id: f.id,
    orderNumber: f.order?.orderNumber || '—',
    feeType: f.feeType,
    feeAmount: +f.feeAmount.toFixed(2),
    baseAmount: +f.baseAmount.toFixed(2),
    payer: f.payer,
    status: f.status,
    collectedAt: f.collectedAt,
    createdAt: f.createdAt,
  }))

  return ok({
    range: dateRange.label,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
    totalCollected: +totalCollected.toFixed(2),
    totalPending: +totalPending.toFixed(2),
    totalRefunded: +totalRefunded.toFixed(2),
    totalWaived: +totalWaived.toFixed(2),
    restaurantPortion: +restaurantPortion.toFixed(2),
    customerPortion: +customerPortion.toFixed(2),
    totalFees: fees.length,
    byFeeType,
    byPayer,
    recentFees,
  })
}
