import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { updateOrderStatusSchema } from '@/lib/validations'
import { publishRealtime } from '@/lib/realtime-server'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/orders/[id]/status
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ['NEW', 'ACCEPTED', 'CANCELLED'],
  // NEW → PREPARING is allowed so the Kitchen Display's "Start preparing"
  // action works on a fresh order in one step (accept + start cooking).
  NEW: ['ACCEPTED', 'PREPARING', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('orders.update_status')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const { id } = await ctx.params
  const order = await db.order.findUnique({
    where: { id },
    include: { table: true },
  })
  if (!order) return fail('Order not found.', 404)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (restaurantId && order.restaurantId !== restaurantId) {
    return fail('Order not found.', 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = updateOrderStatusSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid status.', 422)
  }
  const { status: newStatus } = parsed.data

  const allowed = VALID_TRANSITIONS[order.status] || []
  if (!allowed.includes(newStatus)) {
    return fail(
      `Cannot transition order from ${order.status} to ${newStatus}. Valid transitions: ${
        allowed.length ? allowed.join(', ') : 'none (terminal)'
      }.`,
      409,
    )
  }

  const now = new Date()
  const patch: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'ACCEPTED') {
    patch.acceptedAt = now
    patch.acceptedById = user.id
  } else if (newStatus === 'PREPARING') {
    patch.preparingAt = now
  } else if (newStatus === 'READY') {
    patch.readyAt = now
  } else if (newStatus === 'SERVED') {
    patch.servedAt = now
    patch.servedById = user.id
    // Also update table status back to BILL_REQUESTED (or AVAILABLE)
    if (order.table) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'BILL_REQUESTED' },
      })
    }
  } else if (newStatus === 'COMPLETED') {
    patch.completedAt = now
    // Set table back to AVAILABLE
    if (order.table) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE' },
      })
    }
  } else if (newStatus === 'CANCELLED') {
    patch.cancelledAt = now
  }

  const updated = await db.order.update({
    where: { id },
    data: patch,
    include: { table: true },
  })

  // Notification
  await db.notification.create({
    data: {
      restaurantId: order.restaurantId,
      target:
        newStatus === 'READY'
          ? 'WAITER'
          : newStatus === 'SERVED'
          ? 'CUSTOMER'
          : 'CUSTOMER',
      type: `ORDER_${newStatus}`,
      title: `Order ${order.orderNumber} → ${newStatus}`,
      message: `Table ${order.table?.number} • Status updated to ${newStatus}`,
      orderId: order.id,
      tableId: order.tableId,
    },
  })

  writeAudit(user, 'STATUS_CHANGE', 'ORDER', order.id, {
    from: order.status,
    to: newStatus,
  })

  publishRealtime('order:statusChanged', {
    restaurantId: order.restaurantId,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      tableNumber: order.table?.number,
      status: newStatus,
      paymentStatus: order.paymentStatus,
    },
  })

  return ok(updated)
}
