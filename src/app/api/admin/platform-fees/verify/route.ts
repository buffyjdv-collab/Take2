import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'
import { publishRealtime } from '@/lib/realtime-server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  paymentId: z.string().min(1),
  providerTxnId: z.string().min(1),
})

/**
 * POST /api/admin/platform-fees/verify
 *
 * Tenant "verifies" a platform fee payment they just initiated. The
 * server always decides the final status (no client trust). We simulate
 * verification here (mock provider); a real gateway integration would
 * call the gateway's verify endpoint.
 *
 * On verify:
 *  1. PlatformFeePayment transitions PROCESSING → PAID
 *  2. Covered PlatformFee rows transition PENDING → COLLECTED
 *  3. If linked to a PlatformFeePaymentRequest, update its amountPaid
 *     and (if fully paid) status → PAID + paidAt
 *  4. Fire `platform:feeCollected` (per fee) + `platform:feePaid` (lump sum)
 *     realtime events to both the tenant and the platform admin.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return fail('Unauthorized.', 401)
  const restaurantId = (session.user as any).restaurantId as string | null
  if (!restaurantId) return fail('No tenant scope.', 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const { paymentId, providerTxnId } = parsed.data

  const payment = await db.platformFeePayment.findUnique({
    where: { id: paymentId },
    include: { restaurant: { select: { id: true, name: true } } },
  })
  if (!payment) return fail('Payment not found.', 404)
  // Security: tenant can only verify their own payments
  if (payment.restaurantId !== restaurantId) {
    return fail('Payment not found.', 404)
  }
  if (payment.providerTxnId !== providerTxnId) {
    return fail('Provider transaction ID mismatch.', 400)
  }
  if (payment.status === 'PAID') {
    return ok({ payment, alreadyPaid: true })
  }
  if (payment.status === 'COLLECTED_DIRECT') {
    return ok({ payment, alreadyPaid: true })
  }

  const verifiedAt = new Date()

  // Mark the payment as PAID
  await db.platformFeePayment.update({
    where: { id: paymentId },
    data: {
      status: 'PAID',
      verifiedAt,
      verifiedById: (session.user as any).id,
      failureReason: null,
    },
  })

  // Mark covered fees as COLLECTED
  const coveredEntries = await db.platformFeeCoveredEntry.findMany({
    where: { paymentId },
    select: { platformFeeId: true },
  })
  if (coveredEntries.length > 0) {
    await db.platformFee.updateMany({
      where: { id: { in: coveredEntries.map((e) => e.platformFeeId) } },
      data: { status: 'COLLECTED', collectedAt: verifiedAt },
    })
  }

  // If linked to a request, update request's amountPaid + status
  if (payment.requestId) {
    const totalPaid = await db.platformFeePayment.aggregate({
      where: {
        requestId: payment.requestId,
        status: { in: ['PAID', 'COLLECTED_DIRECT'] },
      },
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

  await db.auditLog.create({
    data: {
      restaurantId,
      userId: (session.user as any).id,
      action: 'PAY_PLATFORM_FEES',
      entity: 'PLATFORM_FEE_PAYMENT',
      entityId: paymentId,
      details: JSON.stringify({
        amount: payment.amount,
        method: payment.method,
        feesCovered: coveredEntries.length,
      }),
    },
  })

  // Realtime: per-fee COLLECTED + lump-sum PAID
  for (const entry of coveredEntries) {
    publishRealtime('platform:feeCollected', {
      restaurantId,
      payload: {
        feeId: entry.platformFeeId,
        paymentId,
        collectedAt: verifiedAt.toISOString(),
      },
    })
  }
  publishRealtime('platform:feePaid', {
    restaurantId,
    payload: {
      paymentId,
      amount: payment.amount,
      method: payment.method,
      status: 'PAID',
      feeCount: coveredEntries.length,
      restaurantName: payment.restaurant.name,
      paidAt: verifiedAt.toISOString(),
    },
  })

  return ok({
    paymentId,
    status: 'PAID',
    amount: payment.amount,
    feesCovered: coveredEntries.length,
    verifiedAt: verifiedAt.toISOString(),
  })
}
