import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'
import { resolveDateRange } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * Payment & Collection Report.
 *
 * By Method:
 *   UPI       ₹2,45,000
 *   Card      ₹1,20,000
 *   Cash        ₹82,000
 *   Other       ₹18,000
 *   ──────────────────
 *   Collected ₹4,65,000
 *
 * By Status:
 *   Successful | Pending | Failed | Refunded
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
  }

  // All payments in range
  const payments = await db.payment.findMany({
    where: { order: orderWhere },
    select: {
      method: true,
      status: true,
      amount: true,
      createdAt: true,
    },
  })

  // All orders in range (for refund tracking)
  const orders = await db.order.findMany({
    where: orderWhere,
    select: {
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      refundAmount: true,
      grandTotal: true,
      netTotal: true,
    },
  })

  // Group by method
  const methodMap: Record<string, { collected: number; pending: number; failed: number; refunded: number; count: number }> = {
    UPI: { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 },
    CARD: { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 },
    CASH: { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 },
    COUNTER: { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 },
    WALLET: { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 },
  }

  for (const p of payments) {
    const m = p.method || 'OTHER'
    if (!methodMap[m]) {
      methodMap[m] = { collected: 0, pending: 0, failed: 0, refunded: 0, count: 0 }
    }
    if (p.status === 'PAID') methodMap[m].collected += p.amount
    else if (p.status === 'PENDING' || p.status === 'PROCESSING') methodMap[m].pending += p.amount
    else if (p.status === 'FAILED') methodMap[m].failed += p.amount
    else if (p.status === 'REFUNDED') methodMap[m].refunded += p.amount
    methodMap[m].count += 1
  }

  // Normalize "COUNTER" → "CASH" for the report display (counter payments are essentially cash at counter)
  // We'll keep both but also include an "OTHER" bucket for unexpected methods

  // Build final method list (only methods that had any activity)
  const byMethod = Object.entries(methodMap)
    .filter(([, v]) => v.count > 0)
    .map(([method, v]) => {
      const total = v.collected + v.pending + v.failed + v.refunded
      return {
        method,
        collected: +v.collected.toFixed(2),
        pending: +v.pending.toFixed(2),
        failed: +v.failed.toFixed(2),
        refunded: +v.refunded.toFixed(2),
        count: v.count,
        total: +total.toFixed(2),
      }
    })
    .sort((a, b) => b.collected - a.collected)

  // Total collected = sum of all PAID payments
  const collected = payments
    .filter((p) => p.status === 'PAID')
    .reduce((s, p) => s + p.amount, 0)

  // Pending = sum of PENDING + PROCESSING payments
  const pending = payments
    .filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING')
    .reduce((s, p) => s + p.amount, 0)

  // Failed = sum of FAILED payments
  const failed = payments
    .filter((p) => p.status === 'FAILED')
    .reduce((s, p) => s + p.amount, 0)

  // Refunded = sum of REFUNDED payments + sum of order.refundAmount for paid orders
  const refundedPayments = payments
    .filter((p) => p.status === 'REFUNDED')
    .reduce((s, p) => s + p.amount, 0)
  const refundedOrders = orders
    .filter((o) => o.refundAmount > 0)
    .reduce((s, o) => s + o.refundAmount, 0)
  const refunded = refundedPayments + refundedOrders

  // Summary
  const byStatus = {
    successful: {
      amount: +collected.toFixed(2),
      count: payments.filter((p) => p.status === 'PAID').length,
    },
    pending: {
      amount: +pending.toFixed(2),
      count: payments.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length,
    },
    failed: {
      amount: +failed.toFixed(2),
      count: payments.filter((p) => p.status === 'FAILED').length,
    },
    refunded: {
      amount: +refunded.toFixed(2),
      count: payments.filter((p) => p.status === 'REFUNDED').length + orders.filter((o) => o.refundAmount > 0).length,
    },
  }

  return ok({
    range: dateRange.label,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
    byMethod,
    byStatus,
    collected: +collected.toFixed(2),
    pending: +pending.toFixed(2),
    failed: +failed.toFixed(2),
    refunded: +refunded.toFixed(2),
    totalOrders: orders.length,
  })
}
