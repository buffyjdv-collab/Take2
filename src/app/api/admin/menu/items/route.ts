import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
  enforcePlanLimit,
} from '@/lib/api-helpers'
import { menuItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/admin/menu/items
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const items = await db.menuItem.findMany({
    where: restaurantId ? { restaurantId } : {},
    include: {
      category: true,
      variants: { orderBy: { sortOrder: 'asc' } },
      modifierGroups: {
        include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return ok(items)
}

// POST /api/admin/menu/items
export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requirePermission('menu.create')
    if (error) return error
    if (!user) return fail('Unauthorized', 401)
    if (user.role !== 'SUPER_ADMIN' && !user.restaurantId) {
      return fail('You are not assigned to a restaurant.', 400)
    }
    const restaurantId = user.restaurantId as string

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return fail('Invalid JSON body.', 400)
    }
    const parsed = menuItemSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
    }
    const data = parsed.data

    // Validate category belongs to restaurant
    const cat = await db.menuCategory.findUnique({ where: { id: data.categoryId } })
    if (!cat || cat.restaurantId !== restaurantId) {
      return fail('Invalid category. Please select a valid category or create one first.', 422)
    }

    // Plan limit enforcement
    const limitErr = await enforcePlanLimit(restaurantId, 'maxMenuItems')
    if (limitErr) return limitErr

    const item = await db.menuItem.create({
      data: {
        restaurantId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description || null,
        image: data.image || null,
        isVeg: data.isVeg ?? true,
        isSpicy: data.isSpicy ?? false,
        basePrice: data.basePrice,
        taxRate: data.taxRate ?? 0.05,
        available: data.available ?? true,
        soldOut: data.soldOut ?? false,
        isFeatured: data.isFeatured ?? false,
        isPopular: data.isPopular ?? false,
        prepTime: data.prepTime ?? 15,
        tags: data.tags || null,
        sortOrder: data.sortOrder ?? 0,
        variants: data.variants?.length
          ? {
              create: data.variants.map((v, idx) => ({
                name: v.name,
                priceModifier: v.priceModifier,
                isDefault: v.isDefault ?? false,
                sortOrder: v.sortOrder ?? idx,
              })),
            }
          : undefined,
        modifierGroups: data.modifierGroupIds?.length
          ? {
              connect: data.modifierGroupIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        variants: true,
        modifierGroups: { include: { modifiers: true } },
      },
    })
    writeAudit(user, 'CREATE', 'MENU_ITEM', item.id, { name: item.name })
    return ok(item, 201)
  } catch (err: any) {
    console.error('[menu-items POST] unhandled error:', err)
    return fail(
      `Failed to create item: ${err.message || 'Unknown error'}. Please try again.`,
      500,
    )
  }
}
