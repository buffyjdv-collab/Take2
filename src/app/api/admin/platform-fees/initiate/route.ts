import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'
import { buildUpiDeepLink, buildUpiQrPayload } from '@/lib/upi'
import { publishRealtime } from '@/lib/realtime-server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  // Amount to pay (rupees). If null/undefined, defaults to outstanding.
  amount: z.number().positive().optional(),
  // Payment method type — must match an active PlatformPaymentMethod.type
  method: z.enum(['UPI', 'QR', 'CARD', 'WALLET', 'NETBANKING']),
  // Optional payment-method id (if tenant picked a specific row)
  paymentMethodId: z.string().optional(),
  // Optional payment request ID — if paying off a specific admin request
  requestId: z.string().optional(),
})

/**
 * POST /api/admin/platform-fees/initiate
 *
 * Tenant initiates a payment for their outstanding platform fees. Returns
 * a paymentId + (for UPI/QR) a UPI deep link + QR payload. The tenant's
 * frontend then takes over (open UPI app / show QR / wait for mock card
 * flow), and after `verifyInMs` calls /api/admin/platform-fees/verify.
 *
 * The covered fees are NOT yet marked as COLLECTED — that happens in
 * `verify`. We just create a PlatformFeePayment row with status PROCESSING
 * and pick which PENDING fees this payment will cover (oldest first, up
 * to `amount` rupees).
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
  const input = parsed.data

  // Resolve the platform payment method row (must be active)
  let methodRow: Awaited<ReturnType<typeof db.platformPaymentMethod.findFirst>> = null
  if (input.paymentMethodId) {
    methodRow = await db.platformPaymentMethod.findFirst({
      where: { id: input.paymentMethodId, active: true, type: input.method },
    })
    if (!methodRow) {
      return fail('This payment method is no longer available. Please choose another.', 404)
    }
  } else {
    methodRow = await db.platformPaymentMethod.findFirst({
      where: { active: true, type: input.method },
      orderBy: { priority: 'asc' },
    })
    if (!methodRow) {
      return fail('This payment method is not configured by the platform.', 403)
    }
  }

  // Determine amount — default to outstanding (sum of PENDING fees)
  let amountToPay = input.amount
  if (!amountToPay) {
    const agg = await db.platformFee.aggregate({
      where: { restaurantId, status: 'PENDING' },
      _sum: { feeAmount: true },
    })
    amountToPay = agg._sum.feeAmount || 0
    if (amountToPay === 0) {
      return fail('You have no pending platform fees to pay.', 400)
    }
  }

  // Cap to outstanding if tenant tried to overpay
  const outstandingAgg = await db.platformFee.aggregate({
    where: { restaurantId, status: 'PENDING' },
    _sum: { feeAmount: true },
  })
  const outstanding = outstandingAgg._sum.feeAmount || 0
  if (amountToPay > outstanding + 0.01) {
    amountToPay = outstanding
  }

  // Pick which PENDING fees to cover (oldest first, up to amountToPay)
  const pendingFees = await db.platformFee.findMany({
    where: { restaurantId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, feeAmount: true },
  })
  const coveredFeeIds: string[] = []
  let running = 0
  for (const f of pendingFees) {
    if (running + f.feeAmount > amountToPay + 0.01) {
      // Partially cover this fee? For simplicity, we include the fee if
      // it's the only one and exceeds the amount, otherwise stop.
      if (coveredFeeIds.length === 0) {
        coveredFeeIds.push(f.id)
        running += f.feeAmount
      }
      break
    }
    coveredFeeIds.push(f.id)
    running += f.feeAmount
    if (running >= amountToPay - 0.01) break
  }
  // Actual amount we'll charge — the sum of covered fees
  const actualAmount = +running.toFixed(2)

  // If linked to a payment request, validate it belongs to this restaurant
  if (input.requestId) {
    const request = await db.platformFeePaymentRequest.findUnique({
      where: { id: input.requestId },
    })
    if (!request || request.restaurantId !== restaurantId) {
      return fail('Invalid payment request.', 404)
    }
    if (request.status === 'PAID' || request.status === 'CANCELLED') {
      return fail('This payment request is no longer active.', 400)
    }
  }

  // Resolve UPI config (for UPI/QR methods)
  const methodConfig: any = methodRow.config ? JSON.parse(methodRow.config) : {}
  const upiId = methodConfig.upiId || null

  let upiDeepLink: string | undefined
  let upiQrPayload: string | undefined

  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  })

  if (input.method === 'UPI' || input.method === 'QR') {
    if (!upiId) {
      return fail(
        'The platform has not configured a UPI ID yet. Please choose another payment method.',
        400,
      )
    }
    const ref = `PF-${Date.now().toString(36).toUpperCase()}`
    upiDeepLink = buildUpiDeepLink(upiId, actualAmount, ref, 'QR Dine Platform')
    upiQrPayload = buildUpiQrPayload(upiId, actualAmount, ref, 'QR Dine Platform')
  }

  // Create PlatformFeePayment row with status PROCESSING
  const providerTxnId = `MOCK-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`
  const payment = await db.platformFeePayment.create({
    data: {
      restaurantId,
      amount: actualAmount,
      method: input.method,
      status: 'PROCESSING',
      provider: methodConfig.provider || 'MOCK',
      providerTxnId,
      idempotencyKey: `pfp-${restaurantId}-${Date.now()}`,
      requestId: input.requestId || null,
      note: 'Platform fee payment',
    },
  })

  // Link the covered fees (but don't mark them COLLECTED yet — wait for verify)
  if (coveredFeeIds.length > 0) {
    await db.platformFeeCoveredEntry.createMany({
      data: coveredFeeIds.map((feeId) => ({
        paymentId: payment.id,
        platformFeeId: feeId,
      })),
    })
  }

  // Realtime: tenant → admin
  publishRealtime('platform:feePaymentInit', {
    restaurantId,
    payload: {
      paymentId: payment.id,
      amount: actualAmount,
      method: input.method,
      restaurantName: restaurant?.name || '',
      feeCount: coveredFeeIds.length,
      initiatedAt: new Date().toISOString(),
    },
  })

  return ok({
    paymentId: payment.id,
    providerTxnId,
    amount: actualAmount,
    method: input.method,
    paymentMethodId: methodRow.id,
    paymentMethodLabel: methodRow.label,
    upiDeepLink,
    upiQrPayload,
    upiId: upiId || undefined,
    feesCovered: coveredFeeIds.length,
    // Mock: tell client to verify in 2 seconds (simulates the customer
    // completing the payment in their UPI app / card gateway)
    verifyInMs: 2000,
  })
}
