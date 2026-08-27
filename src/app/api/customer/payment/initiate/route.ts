import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'
import { initiatePaymentSchema } from '@/lib/validations'
import { buildUpiDeepLink, buildUpiQrPayload } from '@/lib/upi'
import { toApiPaymentProvider } from '@/lib/payment-method-defaults'

export const dynamic = 'force-dynamic'

/**
 * POST /api/customer/payment/initiate
 *
 * Body: { orderId, method: PaymentMethodType, paymentMethodId? }
 *
 * For UPI / QR method, also returns:
 *   - upiDeepLink: upi://pay?... URL that opens the customer's UPI app
 *   - upiQrPayload: the string to encode in a QR code (same as deep link)
 *   - upiId: the restaurant's UPI ID (VPA)
 *
 * For CARD / WALLET / NETBANKING / PAY_LATER / CUSTOM: returns a mock
 * providerTxnId and verifyInMs (the customer "completes" the payment on
 * the client side after a short delay).
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = initiatePaymentSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const input = parsed.data

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    include: { restaurant: true },
  })
  if (!order) return fail('Order not found.', 404)

  const r = order.restaurant

  // Resolve the configured payment-method row (if the customer tapped a
  // specific one). Falls back to the first active method of the same type.
  let methodRow: Awaited<ReturnType<typeof db.restaurantPaymentMethod.findFirst>> = null
  if (input.paymentMethodId) {
    methodRow = await db.restaurantPaymentMethod.findFirst({
      where: {
        id: input.paymentMethodId,
        restaurantId: r.id,
        active: true,
        type: input.method,
      },
    })
    if (!methodRow) {
      return fail('This payment method is no longer available. Please choose another.', 404)
    }
  } else {
    methodRow = await db.restaurantPaymentMethod.findFirst({
      where: { restaurantId: r.id, active: true, type: input.method },
      orderBy: { priority: 'asc' },
    })
    // For CASH / COUNTER we don't actually initiate a payment online — those
    // go through the admin "mark cash paid" flow. If the customer taps one
    // here anyway, just return a friendly error.
    if (!methodRow && (input.method === 'CASH' || input.method === 'COUNTER')) {
      return fail(
        'Cash / counter payments are handled by your waiter. Please let them know.',
        400,
      )
    }
    if (!methodRow) {
      return fail('This payment method is not available for this restaurant.', 403)
    }
  }

  // For UPI / QR: prefer the per-method `upiId` from config, fall back to the
  // legacy Restaurant.upiId field.
  const config = (methodRow.config as any) || {}
  const upiId = config.upiId || r.upiId || null

  let upiDeepLink: string | undefined
  let upiQrPayload: string | undefined

  if (input.method === 'UPI' || input.method === 'QR') {
    if (!upiId) {
      return fail(
        'This restaurant has not configured a UPI ID yet. Please choose another payment method or pay in cash.',
        400,
      )
    }
    upiDeepLink = buildUpiDeepLink(upiId, order.grandTotal, order.orderNumber, r.name)
    upiQrPayload = buildUpiQrPayload(upiId, order.grandTotal, order.orderNumber, r.name)
  }

  // Create payment record with status PROCESSING
  const providerTxnId = `MOCK-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      method: input.method,
      status: 'PROCESSING',
      amount: order.grandTotal,
      currency: r.currency,
      provider: toApiPaymentProvider(input.method, methodRow.config as any),
      providerTxnId,
      idempotencyKey: `pay-${order.id}-${Date.now()}`,
    },
  })

  await db.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: 'PROCESSING',
      paymentMethod: input.method,
    },
  })

  return ok({
    paymentId: payment.id,
    providerTxnId,
    amount: order.grandTotal,
    currency: r.currency,
    method: input.method,
    paymentMethodId: methodRow.id,
    paymentMethodLabel: methodRow.label,
    // For UPI / QR: include deep link + QR payload + the VPA
    upiDeepLink,
    upiQrPayload,
    upiId: upiId || undefined,
    restaurantName: r.name,
    orderNumber: order.orderNumber,
    // Mock: tell client to "verify" in 1.5 seconds (simulates the customer
    // completing the payment in their UPI app / wallet / card gateway)
    verifyInMs: 1500,
  })
}
