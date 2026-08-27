import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
} from '@/lib/api-helpers'
import { reorderPaymentMethodsSchema } from '@/lib/validations'
import { syncLegacyFlags } from '../route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/payment-methods/reorder
 * Body: { orderedIds: string[] }
 * Updates priority for all rows in the order given (idx*10).
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requirePermission('settings.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('No restaurant scope available.', 400)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = reorderPaymentMethodsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const { orderedIds } = parsed.data

  // Verify all IDs belong to this restaurant (multi-tenant safety).
  const owned = await db.restaurantPaymentMethod.findMany({
    where: { id: { in: orderedIds }, restaurantId },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((m) => m.id))
  if (orderedIds.some((id) => !ownedIds.has(id))) {
    return fail('One or more payment methods do not belong to this restaurant.', 403)
  }

  await db.$transaction(
    orderedIds.map((id, idx) =>
      db.restaurantPaymentMethod.update({
        where: { id },
        data: { priority: (idx + 1) * 10 },
      }),
    ),
  )

  await syncLegacyFlags(restaurantId)
  return ok({ ok: true })
}
