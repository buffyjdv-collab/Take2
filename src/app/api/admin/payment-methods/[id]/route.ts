import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { updatePaymentMethodSchema } from '@/lib/validations'
import { syncLegacyFlags } from '../route'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/payment-methods/[id]
 * Update label / description / icon / accentColor / active / priority / config.
 * Body shape: see `updatePaymentMethodSchema`.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requirePermission('settings.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('No restaurant scope available.', 400)
  }

  const { id } = await params
  // Verify ownership (multi-tenant safety).
  const existing = await db.restaurantPaymentMethod.findUnique({ where: { id } })
  if (!existing || existing.restaurantId !== restaurantId) {
    return fail('Payment method not found.', 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = updatePaymentMethodSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  const updated = await db.restaurantPaymentMethod.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.icon !== undefined ? { icon: data.icon || null } : {}),
      // accentColor is non-nullable in DB (has default) — only update if a non-null value is passed
      ...(data.accentColor !== undefined && data.accentColor !== null
        ? { accentColor: data.accentColor }
        : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.config !== undefined ? { config: data.config as any } : {}),
    },
  })

  await syncLegacyFlags(restaurantId)

  writeAudit(user, 'UPDATE', 'PAYMENT_METHOD', id, data as any)
  return ok(updated)
}

/**
 * DELETE /api/admin/payment-methods/[id]
 * Removes the payment method. (Use PATCH with `active: false` to disable instead.)
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requirePermission('settings.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('No restaurant scope available.', 400)
  }

  const { id } = await params
  const existing = await db.restaurantPaymentMethod.findUnique({ where: { id } })
  if (!existing || existing.restaurantId !== restaurantId) {
    return fail('Payment method not found.', 404)
  }

  await db.restaurantPaymentMethod.delete({ where: { id } })
  await syncLegacyFlags(restaurantId)

  writeAudit(user, 'DELETE', 'PAYMENT_METHOD', id, { type: existing.type, label: existing.label })
  return ok({ ok: true })
}
