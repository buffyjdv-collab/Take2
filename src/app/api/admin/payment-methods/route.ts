import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { createPaymentMethodSchema, reorderPaymentMethodsSchema } from '@/lib/validations'
import { PAYMENT_METHOD_PRESETS, defaultSeededPaymentMethods } from '@/lib/payment-method-defaults'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/payment-methods
 * Returns the restaurant's configured payment methods, sorted by priority.
 * If the restaurant has no rows yet (legacy tenant), seeds the defaults on
 * first read so the admin UI always has something to show.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('No restaurant scope available. Super admins must pass ?restaurantId=.', 400)
  }

  // Lazy seed: if the restaurant has no payment-method rows (legacy or new
  // tenant), backfill the defaults now using their upiId if present.
  const count = await db.restaurantPaymentMethod.count({ where: { restaurantId } })
  if (count === 0) {
    const r = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: { upiId: true },
    })
    const defaults = defaultSeededPaymentMethods(r?.upiId || null)
    await db.restaurantPaymentMethod.createMany({
      data: defaults.map((d) => ({
        restaurantId,
        type: d.type,
        label: d.label,
        description: d.description,
        icon: d.icon,
        accentColor: d.accentColor,
        active: d.active,
        priority: d.priority,
        config: d.config as any,
      })),
    })
  }

  const methods = await db.restaurantPaymentMethod.findMany({
    where: { restaurantId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })

  return ok({ methods, presets: PAYMENT_METHOD_PRESETS })
}

/**
 * POST /api/admin/payment-methods
 * Create a new payment method for the scoped restaurant.
 * Body shape: see `createPaymentMethodSchema`.
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
  const parsed = createPaymentMethodSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // If a preset matches the chosen type and no overrides were supplied,
  // fill in the preset defaults for icon/accentColor/priority/description.
  const preset = PAYMENT_METHOD_PRESETS.find((p) => p.type === data.type)
  const created = await db.restaurantPaymentMethod.create({
    data: {
      restaurantId,
      type: data.type,
      label: data.label,
      description: data.description ?? preset?.description ?? null,
      icon: data.icon ?? preset?.icon ?? null,
      accentColor: data.accentColor ?? preset?.accentColor ?? '#64748B',
      active: data.active ?? true,
      priority: data.priority ?? preset?.priority ?? 100,
      config: (data.config ?? preset?.config ?? null) as any,
    },
  })

  await syncLegacyFlags(restaurantId)

  writeAudit(user, 'CREATE', 'PAYMENT_METHOD', created.id, { type: created.type, label: created.label })
  return ok(created, 201)
}

/**
 * PATCH /api/admin/payment-methods (collection-level)
 * Body: { orderedIds: string[] }   (reorders priorities)
 *
 * Per-row PATCH is at /api/admin/payment-methods/[id].
 */
export async function PATCH_collection(req: NextRequest) {
  /* placeholder — kept for future collection-level patches */
  return fail('Not implemented', 404)
}

/**
 * Sync the legacy `acceptUpi/Card/Cash/Counter` boolean flags on the
 * Restaurant row based on the active payment-method rows. Kept for backward
 * compatibility with code that still reads those flags (e.g. bill-view,
 * some legacy API endpoints).
 */
export async function syncLegacyFlags(restaurantId: string) {
  const active = await db.restaurantPaymentMethod.findMany({
    where: { restaurantId, active: true },
    select: { type: true },
  })
  const types = new Set(active.map((m) => m.type))
  await db.restaurant.update({
    where: { id: restaurantId },
    data: {
      acceptUpi: types.has('UPI') || types.has('QR'),
      acceptCard: types.has('CARD'),
      acceptCash: types.has('CASH'),
      acceptCounter: types.has('COUNTER'),
    },
  })

  // Propagate the first active UPI method's `upiId` config to the
  // Restaurant.upiId legacy field (used by the UPI deep-link builder).
  const upiMethod = await db.restaurantPaymentMethod.findFirst({
    where: { restaurantId, type: 'UPI', active: true },
    orderBy: { priority: 'asc' },
  })
  const upiId = (upiMethod?.config as any)?.upiId
  if (typeof upiId === 'string') {
    await db.restaurant.update({
      where: { id: restaurantId },
      data: { upiId: upiId || null },
    })
  }
}

// Re-export reorder handler so it can be imported by [id] route if needed.
export { reorderPaymentMethodsSchema }
