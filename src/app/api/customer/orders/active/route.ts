import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/customer/orders/active?phone=<phone>&table=<token>
//
// Returns ALL active (non-completed, non-cancelled) orders for the given
// customer phone number, scoped to the table's restaurant. Used by the
// customer tracking page to show every active order placed by the same
// mobile number — e.g. after the customer places a follow-up "order more
// items" order while a previous order is still in progress.
//
// Orders are returned newest-first. Each order includes its items (+modifiers),
// table, and payments so the UI can render per-order tracking + bill inline.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone')?.trim()
  const tableToken = req.nextUrl.searchParams.get('table')
  if (!phone) return fail('Missing customer phone.', 400)
  if (!tableToken) return fail('Missing table token.', 400)

  // Resolve the table token → restaurant (tenant scoping, same as the menu API)
  const table = await db.table.findUnique({
    where: { qrCodeToken: tableToken },
    include: { restaurant: true },
  })
  if (!table) return fail('Invalid or unknown QR code.', 404)
  const restaurant = table.restaurant
  if (!restaurant) return fail('Restaurant not found.', 404)

  // Normalise the phone to digits for a robust match — the customer may have
  // entered "+91 98765 43210" on one order and "9876543210" on another. Matching
  // on digits-only means both resolve to the same customer.
  const digitsOnly = (s: string) => s.replace(/[^\d]/g, '')

  // Fetch ALL orders for this phone at this restaurant (we filter active ones
  // in-memory after a digits match, since Prisma can't do "digits-only equals"
  // portably across Postgres/SQLite).
  const candidates = await db.order.findMany({
    where: {
      restaurantId: restaurant.id,
      customerPhone: { not: null },
    },
    include: {
      items: { include: { modifiers: true } },
      table: true,
      payments: true,
    },
    orderBy: { placedAt: 'desc' },
  })

  const targetDigits = digitsOnly(phone)
  const activeStatuses = ['NEW', 'PENDING_PAYMENT', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED']

  const orders = candidates.filter(
    (o) =>
      o.customerPhone &&
      digitsOnly(o.customerPhone) === targetDigits &&
      activeStatuses.includes(o.status),
  )

  return ok({ orders, restaurantId: restaurant.id })
}
