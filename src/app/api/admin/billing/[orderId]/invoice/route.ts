import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  generateInvoiceNumber,
  restaurantPrefix,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/billing/[orderId]/invoice
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { user, error } = await requirePermission('billing.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { orderId } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      table: true,
      restaurant: true,
      customer: true,
      items: { include: { modifiers: true } },
      payments: true,
      invoices: true,
    },
  })
  if (!order) return fail('Order not found.', 404)
  if (restaurantId && order.restaurantId !== restaurantId) {
    return fail('Order not found.', 404)
  }
  return ok({
    order,
    invoice: order.invoices[0] || null,
  })
}

// POST /api/admin/billing/[orderId]/invoice — generate invoice if not exists
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { user, error } = await requirePermission('billing.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { orderId } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { restaurant: true, table: true, customer: true, invoices: true },
  })
  if (!order) return fail('Order not found.', 404)
  if (restaurantId && order.restaurantId !== restaurantId) {
    return fail('Order not found.', 404)
  }

  if (order.invoices[0]) return ok(order.invoices[0])

  const invoiceCount = await db.invoice.count({
    where: { restaurantId: order.restaurantId },
  })
  const prefix = restaurantPrefix(order.restaurant.name)
  const invoiceNumber = generateInvoiceNumber(prefix, invoiceCount)

  const invoice = await db.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurant.name,
      restaurantAddress: order.restaurant.address,
      restaurantGst: order.restaurant.gstNumber,
      restaurantPhone: order.restaurant.phone,
      tableNumber: order.table?.number || '-',
      orderNumber: order.orderNumber,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      serviceCharge: order.serviceCharge,
      discountAmount: order.discountAmount,
      grandTotal: order.grandTotal,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      customerName: order.customer?.name || null,
      customerPhone: order.customer?.phone || null,
    },
  })
  return ok(invoice, 201)
}
