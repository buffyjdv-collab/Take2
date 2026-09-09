import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'
import { resolveDateRange } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

function csvEscape(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  const str = String(s)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// GET /api/admin/reports/export?range=7d&from=&to=&format=csv
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('reports.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  // Branch-scoped staff (branch managers) see only their branch's numbers.
  const branchId = scopeBranchId(user)

  const sp = req.nextUrl.searchParams
  const range = sp.get('range') || '7d'
  let dateRange
  try {
    dateRange = resolveDateRange(range, sp.get('from'), sp.get('to'))
  } catch (e: any) {
    return fail(e.message, 400)
  }
  const from = dateRange.from
  const to = dateRange.to

  const orders = await db.order.findMany({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      ...(branchId ? { branchId } : {}),
      placedAt: { gte: from, lte: to },
    },
    orderBy: { placedAt: 'asc' },
    include: {
      table: { select: { number: true } },
      items: { select: { id: true, menuItemName: true, quantity: true, totalPrice: true } },
    },
  })

  const header = [
    'Order Number',
    'Table',
    'Placed At',
    'Status',
    'Payment Status',
    'Payment Method',
    'Items',
    'Subtotal',
    'Tax',
    'Service Charge',
    'Discount',
    'Refund',
    'Grand Total',
    'Net Total',
    'Platform Fee',
  ].join(',')

  const rows = orders.map((o) =>
    [
      csvEscape(o.orderNumber),
      csvEscape(o.table?.number),
      csvEscape(o.placedAt.toISOString()),
      csvEscape(o.status),
      csvEscape(o.paymentStatus),
      csvEscape(o.paymentMethod),
      csvEscape(o.items.map((i) => `${i.quantity}x ${i.menuItemName}`).join(' | ')),
      o.subtotal.toFixed(2),
      o.taxAmount.toFixed(2),
      o.serviceCharge.toFixed(2),
      o.discountAmount.toFixed(2),
      o.refundAmount.toFixed(2),
      o.grandTotal.toFixed(2),
      o.netTotal.toFixed(2),
      o.platformFeeAmount.toFixed(2),
    ].join(','),
  )

  const csv = [header, ...rows].join('\n')
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${from.toISOString().slice(0,10)}-to-${to.toISOString().slice(0,10)}.csv"`,
    },
  })
}
