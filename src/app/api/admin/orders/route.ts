import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ok, fail, scopeRestaurantId, scopeBranchId } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/admin/orders — list with filters
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('orders.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const sp = req.nextUrl.searchParams
  const restaurantId = scopeRestaurantId(user, sp.get('restaurantId'))
  // Branch-scoped staff (e.g. a branch manager) only see their own branch's
  // orders — kitchen display, waiter and billing all read through this route.
  const staffBranchId = scopeBranchId(user)
  // Owners & super admins can FILTER the list branch-wise via ?branchId=:
  //   ?branchId=<id>  → only that branch's orders
  //   ?branchId=none  → branchless orders (tables without a branch)
  //   ?branchId=all   → everything (default, backward compatible)
  // The param is ignored for branch-scoped staff — the server always wins.
  let ownerBranchFilter: string | null | undefined
  if (!staffBranchId) {
    const view = sp.get('branchId')
    if (view && view !== 'all') {
      if (view === 'none') {
        ownerBranchFilter = null
      } else {
        const branch = await db.branch.findUnique({ where: { id: view } })
        if (!branch || (restaurantId && branch.restaurantId !== restaurantId)) {
          return fail('Invalid branch — it does not belong to your restaurant.', 422)
        }
        ownerBranchFilter = view
      }
    }
  }
  const status = sp.get('status')
  const paymentStatus = sp.get('paymentStatus')
  const tableId = sp.get('tableId')
  const search = sp.get('search')?.trim()
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(sp.get('pageSize') || '50', 10)),
  )

  const from = sp.get('from')
  const to = sp.get('to')
  // By default, orders in PENDING_PAYMENT status are hidden from the orders
  // module — they only become visible once the customer pays (and the order
  // transitions to NEW). Super admin / owner can opt in via ?includePendingPayment=true
  // to see them (e.g. to cancel a stuck order).
  const includePendingPayment = sp.get('includePendingPayment') === 'true'

  const where: Record<string, unknown> = {}
  if (restaurantId) where.restaurantId = restaurantId
  if (staffBranchId) {
    where.branchId = staffBranchId
  } else if (ownerBranchFilter !== undefined) {
    where.branchId = ownerBranchFilter
  }
  if (status) {
    // Support comma-separated statuses (e.g. ?status=ACCEPTED,PREPARING) so
    // views like the Kitchen Display "Preparing" column can show orders in
    // more than one status with a single request.
    const statuses = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    where.status = statuses.length > 1 ? { in: statuses } : statuses[0]
  } else if (!includePendingPayment) {
    // Hide PENDING_PAYMENT orders unless explicitly requested
    where.status = { not: 'PENDING_PAYMENT' }
  }
  if (paymentStatus) where.paymentStatus = paymentStatus
  if (tableId) where.tableId = tableId
  if (search) where.orderNumber = { contains: search }
  if (from || to) {
    where.placedAt = {}
    if (from) (where.placedAt as any).gte = new Date(from)
    if (to) (where.placedAt as any).lte = new Date(to)
  }

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        table: { select: { number: true, label: true } },
        branch: { select: { id: true, name: true } },
        items: { select: { id: true, quantity: true, menuItemName: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
  ])

  return ok({
    orders,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}
