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
import { menuCategorySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/admin/menu/categories
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const categories = await db.menuCategory.findMany({
    where: restaurantId ? { restaurantId } : {},
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { menuItems: true } } },
  })
  return ok(categories)
}

// POST /api/admin/menu/categories
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
    const parsed = menuCategorySchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
    }
    const data = parsed.data
    // Plan limit enforcement
    const limitErr = await enforcePlanLimit(restaurantId, 'maxCategories')
    if (limitErr) return limitErr

    const maxSort = await db.menuCategory.aggregate({
      where: { restaurantId },
      _max: { sortOrder: true },
    })
    const category = await db.menuCategory.create({
      data: {
        restaurantId,
        name: data.name,
        description: data.description || null,
        icon: data.icon || null,
        sortOrder: data.sortOrder ?? (maxSort._max.sortOrder || 0) + 1,
        active: data.active ?? true,
      },
    })
    writeAudit(user, 'CREATE', 'MENU_CATEGORY', category.id, { name: category.name })
    return ok(category, 201)
  } catch (err: any) {
    console.error('[categories POST] unhandled error:', err)
    return fail(
      `Failed to create category: ${err.message || 'Unknown error'}. Please try again.`,
      500,
    )
  }
}
