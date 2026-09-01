import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { publishRealtime } from '@/lib/realtime-server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  // Status to set; defaults to PAID
  status: z.enum(['PAID', 'FAILED', 'REFUNDED']).default('PAID'),
  failureReason: z.string().max(500).optional(),
})

/**
 * POST /api/platform/fees/payments/[id]/verify
 *
 * Super admin manually verifies a platform fee payment that was made
 * offline (e.g. tenant sent money via bank transfer). Updates the
 * PlatformFeePayment's status, marks all covered fees as COLLECTED,
 * and fires realtime events.
 *
 * Body: { status?: 'PAID' | 'FAILED' | 'REFUNDED', failureReason?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    requireSuperAdmin(session)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const payment = await db.platformFeePayment.findUnique({
    where: { id },
    include: { restaurant: { select: { id: true, name: true } } },
  })
  if (!payment) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid input.' },
      { status: 422 },
    )
  }
  const { status, failureReason } = parsed.data

  const verifiedAt = new Date()

  // Update the payment record
  await db.platformFeePayment.update({
    where: { id },
    data: {
      status,
      verifiedAt,
      verifiedById: (session.user as any).id,
      failureReason: failureReason || null,
    },
  })

  // Get covered fees
  const coveredEntries = await db.platformFeeCoveredEntry.findMany({
    where: { paymentId: id },
    select: { platformFeeId: true },
  })

  if (status === 'PAID' || status === 'COLLECTED_DIRECT') {
    // Mark covered fees as COLLECTED
    if (coveredEntries.length > 0) {
      await db.platformFee.updateMany({
        where: { id: { in: coveredEntries.map((e) => e.platformFeeId) } },
        data: { status: 'COLLECTED', collectedAt: verifiedAt },
      })

      // Realtime per-fee COLLECTED
      for (const entry of coveredEntries) {
        publishRealtime('platform:feeCollected', {
          restaurantId: payment.restaurantId,
          payload: {
            feeId: entry.platformFeeId,
            paymentId: id,
            collectedAt: verifiedAt.toISOString(),
          },
        })
      }
    }

    // If this payment is linked to a request, update the request's status
    if (payment.requestId) {
      const totalPaid = await db.platformFeePayment.aggregate({
        where: { requestId: payment.requestId, status: { in: ['PAID', 'COLLECTED_DIRECT'] } },
        _sum: { amount: true },
      })
      const request = await db.platformFeePaymentRequest.findUnique({
        where: { id: payment.requestId },
      })
      if (request) {
        const paidSoFar = totalPaid._sum.amount || 0
        const isFullyPaid = paidSoFar >= request.amount
        await db.platformFeePaymentRequest.update({
          where: { id: request.id },
          data: {
            amountPaid: paidSoFar,
            status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            paidAt: isFullyPaid && !request.paidAt ? verifiedAt : request.paidAt,
          },
        })
      }
    }
  }

  // Fire lump-sum realtime event
  publishRealtime('platform:feePaid', {
    restaurantId: payment.restaurantId,
    payload: {
      paymentId: id,
      amount: payment.amount,
      method: payment.method,
      status,
      feeCount: coveredEntries.length,
      restaurantName: payment.restaurant.name,
      paidAt: verifiedAt.toISOString(),
    },
  })

  await db.auditLog.create({
    data: {
      restaurantId: payment.restaurantId,
      userId: (session.user as any).id,
      action: 'VERIFY_PLATFORM_FEE_PAYMENT',
      entity: 'PLATFORM_FEE_PAYMENT',
      entityId: id,
      details: JSON.stringify({ status, failureReason: failureReason || null }),
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      id,
      status,
      verifiedAt: verifiedAt.toISOString(),
      feesCovered: coveredEntries.length,
    },
  })
}
