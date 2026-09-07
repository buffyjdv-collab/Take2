import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/platform-fees
 *
 * Returns the calling tenant's platform fee summary:
 *   - outstanding: sum of PENDING PlatformFee rows for this restaurant
 *   - pendingCount: number of PENDING fees
 *   - oldestPendingDate: ISO date of the oldest PENDING fee (for overdue calc)
 *   - lastPayment: most recent PlatformFeePayment row
 *   - recentPayments: last 20 PlatformFeePayment rows (history)
 *   - activeRequests: PlatformFeePaymentRequest rows with status PENDING or PARTIALLY_PAID
 *   - isOverdue: boolean — pending fees older than 30 days exist
 *   - isBlocked: boolean — restaurant.platformFeeBlocked flag
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const restaurantId = (session.user as any).restaurantId as string | null
  if (!restaurantId) {
    return NextResponse.json({ error: 'No tenant scope.' }, { status: 403 })
  }

  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      name: true,
      plan: true,
      platformFeeBlocked: true,
      platformFeeBlockedAt: true,
      platformFeeBlockReason: true,
    },
  })
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 })
  }

  // Outstanding PENDING fees
  const pendingFees = await db.platformFee.findMany({
    where: { restaurantId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      feeAmount: true,
      createdAt: true,
      feeType: true,
      order: { select: { id: true, orderNumber: true, grandTotal: true } },
    },
  })

  const outstanding = pendingFees.reduce((s, f) => s + f.feeAmount, 0)
  const pendingCount = pendingFees.length
  const oldestPendingDate = pendingFees[0]?.createdAt ?? null
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const isOverdue =
    oldestPendingDate !== null && oldestPendingDate < thirtyDaysAgo

  // Recent payments (history)
  const recentPayments = await db.platformFeePayment.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      provider: true,
      note: true,
      verifiedAt: true,
      createdAt: true,
      _count: { select: { coveredFees: true } },
      request: { select: { id: true, amount: true, status: true } },
    },
  })

  // Active requests
  const activeRequests = await db.platformFeePaymentRequest.findMany({
    where: {
      restaurantId,
      status: { in: ['PENDING', 'PARTIALLY_PAID'] },
    },
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      amount: true,
      amountPaid: true,
      status: true,
      dueDate: true,
      note: true,
      sentAt: true,
    },
  })

  // Lifetime totals
  const totals = await db.platformFee.aggregate({
    where: { restaurantId },
    _sum: { feeAmount: true },
  })
  const collectedTotals = await db.platformFee.aggregate({
    where: { restaurantId, status: 'COLLECTED' },
    _sum: { feeAmount: true },
  })
  const totalLifetime = totals._sum.feeAmount || 0
  const totalCollected = collectedTotals._sum.feeAmount || 0

  const round2 = (n: number) => +n.toFixed(2)

  return NextResponse.json({
    success: true,
    data: {
      restaurant,
      outstanding: round2(outstanding),
      pendingCount,
      oldestPendingDate: oldestPendingDate?.toISOString() ?? null,
      isOverdue,
      isBlocked: restaurant.platformFeeBlocked,
      lastPayment: recentPayments[0]
        ? {
            id: recentPayments[0].id,
            amount: recentPayments[0].amount,
            method: recentPayments[0].method,
            status: recentPayments[0].status,
            paidAt: recentPayments[0].verifiedAt?.toISOString() ?? null,
          }
        : null,
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        provider: p.provider,
        note: p.note,
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        feesCovered: p._count.coveredFees,
        request: p.request,
      })),
      activeRequests: activeRequests.map((r) => ({
        id: r.id,
        amount: r.amount,
        amountPaid: r.amountPaid,
        status: r.status,
        dueDate: r.dueDate?.toISOString() ?? null,
        note: r.note,
        sentAt: r.sentAt.toISOString(),
      })),
      totals: {
        lifetime: round2(totalLifetime),
        collected: round2(totalCollected),
        pending: round2(outstanding),
      },
    },
  })
}
