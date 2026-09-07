import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { publishRealtime } from '@/lib/realtime-server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// POST /api/admin/orders/[id]/mark-cash-paid
// Body: { method?: 'CASH' | 'COUNTER' }   (defaults to CASH)
//
// Allows a waiter / restaurant owner / manager / cashier to mark an order as
// "paid in cash" (or "paid at counter"). The acting user's id + name are
// recorded on the order (cashReceivedById / cashReceivedByName / cashReceivedAt)
// so the payments report can attribute the collection to a specific person.
//
// This endpoint is used in two scenarios:
//   1. POST-PAYMENT: the order has been SERVED and the customer pays cash —
//      the waiter/owner marks it paid, transitioning the order to COMPLETED.
//   2. PRE-PAYMENT:  the order is in PENDING_PAYMENT status and the customer
//      hands cash to the waiter — the waiter marks it paid, transitioning the
//      order to NEW (so the kitchen sees it) — or ACCEPTED if auto-accept is on.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Allow anyone who can verify payments OR manage billing to mark cash paid.
  // This covers OWNER, MANAGER, CASHIER, and WAITER (waiters typically have
  // PAYMENT.VERIFY in the default RBAC matrix).
  const { user, error } = await requirePermission('PAYMENT.VERIFY')
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

  // Parse body (optional `method`)
  let method: 'CASH' | 'COUNTER' = 'CASH'
  try {
    const body = await req.json()
    if (body?.method === 'COUNTER') method = 'COUNTER'
    else if (body?.method === 'CASH') method = 'CASH'
  } catch {
    // Body is optional — default to CASH
  }

  // Idempotency: if already paid, no-op
  if (order.paymentStatus === 'PAID') {
    return fail('This order has already been marked as paid.', 409)
  }

  // Determine the new order status:
  //   - If currently PENDING_PAYMENT (pre-payment flow), transition to NEW
  //     (or ACCEPTED if auto-accept is on) so the kitchen sees it.
  //   - If currently SERVED (post-payment flow), transition to COMPLETED.
  //   - Otherwise keep the current status (the cash payment is just recorded).
  const wasPendingPayment = order.status === 'PENDING_PAYMENT'
  const autoAccept = order.restaurant.settings?.autoAcceptOrders === true
  let newStatus = order.status
  let acceptedAt: Date | undefined
  let completedAt: Date | undefined
  let placedAt: Date | undefined
  if (wasPendingPayment) {
    newStatus = autoAccept ? 'ACCEPTED' : 'NEW'
    if (newStatus === 'ACCEPTED') acceptedAt = new Date()
    else placedAt = new Date() // bump to top of queue
  } else if (order.status === 'SERVED') {
    newStatus = 'COMPLETED'
    completedAt = new Date()
  }

  // Update the order: payment status, method, cash-received-by snapshot, status
  const updated = await db.order.update({
    where: { id },
    data: {
      paymentStatus: 'PAID',
      paymentMethod: method,
      cashReceivedById: user.id,
      // Snapshot the user's name so the report survives later user edits/deletes
      cashReceivedByName: user.name,
      cashReceivedAt: new Date(),
      ...(newStatus !== order.status ? { status: newStatus } : {}),
      ...(acceptedAt ? { acceptedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(placedAt ? { placedAt } : {}),
    },
    include: { table: true },
  })

  // Create a Payment record so the payments report picks it up
  await db.payment.create({
    data: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      method,
      status: 'PAID',
      amount: order.grandTotal,
      currency: order.restaurant.currency || 'INR',
      provider: 'CASH',
      providerTxnId: `CASH-${order.id}-${Date.now()}`,
      verifiedAt: new Date(),
      verifiedById: user.id,
      idempotencyKey: `cash-${order.id}-${Date.now()}`,
    },
  })

  // Mark platform fee as COLLECTED
  await db.platformFee.updateMany({
    where: { orderId: order.id, status: 'PENDING' },
    data: { status: 'COLLECTED', collectedAt: new Date() },
  })

  // Generate invoice if not exists
  let invoice = await db.invoice.findFirst({ where: { orderId: order.id } })
  if (!invoice) {
    const invoiceCount = await db.invoice.count({
      where: { restaurantId: order.restaurantId },
    })
    const { generateInvoiceNumber, restaurantPrefix } = await import('@/lib/api-helpers')
    const prefix = restaurantPrefix(order.restaurant.name)
    const invoiceNumber = generateInvoiceNumber(prefix, invoiceCount)
    invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurant.name,
        restaurantAddress: order.restaurant.address,
        restaurantGst: order.restaurant.gstNumber,
        restaurantPhone: order.restaurant.phone,
        tableNumber: order.table.number,
        orderNumber: order.orderNumber,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        serviceCharge: order.serviceCharge,
        discountAmount: order.discountAmount,
        grandTotal: order.grandTotal,
        paymentMethod: method,
        paymentStatus: 'PAID',
        customerName: order.customerName || null,
        customerPhone: order.customerPhone || null,
      },
    })
  }

  // If the order transitioned out of PENDING_PAYMENT, notify the kitchen
  if (wasPendingPayment && order.restaurant.settings?.notifyKitchenOnNewOrder !== false) {
    await db.notification.create({
      data: {
        restaurantId: order.restaurantId,
        target: 'KITCHEN',
        type: 'NEW_ORDER',
        title: `Order ${order.orderNumber} paid in cash & confirmed`,
        message: `Table ${order.table.number} • ₹${order.grandTotal.toFixed(0)} collected by ${user.name}`,
        orderId: order.id,
        tableId: order.tableId,
      },
    })
  }

  writeAudit(user, 'CASH_PAID', 'ORDER', order.id, {
    method,
    amount: order.grandTotal,
    receivedBy: user.name,
    statusTransition: newStatus !== order.status ? `${order.status} → ${newStatus}` : undefined,
  })

  publishRealtime('payment:confirmed', {
    restaurantId: order.restaurantId,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId: null,
      amount: order.grandTotal,
      method,
      status: 'PAID',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      receivedBy: user.name,
    },
  })

  return ok({
    order: updated,
    invoice,
    method,
    receivedBy: user.name,
    statusTransition: newStatus !== order.status ? `${order.status} → ${newStatus}` : undefined,
  })
}
