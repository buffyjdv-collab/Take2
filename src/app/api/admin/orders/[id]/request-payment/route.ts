import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { requestPaymentSchema } from '@/lib/validations'
import { publishRealtime } from '@/lib/realtime-server'

export const dynamic = 'force-dynamic'

// POST /api/admin/orders/[id]/request-payment
// Body: { when: 'PRE' | 'POST' }
//
// Restaurant owner / cashier can request payment from the customer at two points:
//   PRE:  Before the order is accepted (customer must pay to proceed)
//   POST: After the order is received/served (customer pays before leaving)
//
// This endpoint flags the order and pushes a realtime event so the customer's
// tracking UI shows the payment prompt immediately.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('BILLING.MANAGE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const { id } = await ctx.params
  const order = await db.order.findUnique({
    where: { id },
    include: { table: true, restaurant: { include: { settings: true } } },
  })
  if (!order) return fail('Order not found.', 404)

  const restaurantId = scopeRestaurantId(
    user,
    req.nextUrl.searchParams.get('restaurantId'),
  )
  if (restaurantId && order.restaurantId !== restaurantId) {
    return fail('Order not found.', 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = requestPaymentSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const { when } = parsed.data

  // Check restaurant settings allow this kind of payment request
  const settings = order.restaurant.settings
  if (when === 'PRE' && settings?.allowPrePayment === false) {
    return fail('Pre-payment requests are disabled for this restaurant.', 403)
  }
  if (when === 'POST' && settings?.allowPostPayment === false) {
    return fail('Post-payment requests are disabled for this restaurant.', 403)
  }

  // Sanity checks:
  //   PRE can only be requested while the order is NEW (not yet accepted)
  //   POST can only be requested once the order is SERVED (received)
  if (when === 'PRE' && !['NEW'].includes(order.status)) {
    return fail(
      `Pre-payment can only be requested before the order is accepted (current status: ${order.status}).`,
      409,
    )
  }
  if (when === 'POST' && !['SERVED', 'READY'].includes(order.status)) {
    return fail(
      `Post-payment can only be requested after the order is served (current status: ${order.status}).`,
      409,
    )
  }

  // If already paid, no need to request again
  if (order.paymentStatus === 'PAID') {
    return fail('This order has already been paid.', 409)
  }

  const now = new Date()
  const patch: Record<string, unknown> =
    when === 'PRE'
      ? { prePaymentRequested: true, prePaymentRequestedAt: now }
      : { postPaymentRequested: true, postPaymentRequestedAt: now }

  const updated = await db.order.update({
    where: { id },
    data: patch,
    include: { table: true },
  })

  // Notification row — surfaced on the customer's tracking UI
  await db.notification.create({
    data: {
      restaurantId: order.restaurantId,
      target: 'CUSTOMER',
      type: 'PAYMENT_REQUIRED',
      title: `Payment required for ${order.orderNumber}`,
      message:
        when === 'PRE'
          ? `Please pay ₹${order.grandTotal.toFixed(0)} before we accept your order.`
          : `Your order has been served. Please pay ₹${order.grandTotal.toFixed(0)} to complete.`,
      orderId: order.id,
      tableId: order.tableId,
    },
  })

  writeAudit(user, 'PAYMENT_REQUEST', 'ORDER', order.id, { when })

  // Realtime nudge to the customer
  publishRealtime('payment:requested', {
    restaurantId: order.restaurantId,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      tableNumber: order.table?.number,
      when,
      amount: order.grandTotal,
    },
  })

  return ok(updated)
}
