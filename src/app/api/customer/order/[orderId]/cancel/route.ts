import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'
import { publishRealtime } from '@/lib/realtime-server'

export const dynamic = 'force-dynamic'

// POST /api/customer/order/[orderId]/cancel
// Only allowed if order status is NEW (not yet accepted)
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { table: true },
  })
  if (!order) return fail('Order not found.', 404)
  if (order.status !== 'NEW') {
    return fail(
      `Order cannot be cancelled once it has been accepted (current status: ${order.status}).`,
      409,
    )
  }
  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })

  publishRealtime('order:updated', {
    restaurantId: order.restaurantId,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      tableNumber: order.table?.number || '-',
      status: 'CANCELLED',
    },
  })

  return ok(updated)
}
