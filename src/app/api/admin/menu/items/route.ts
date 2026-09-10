import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  scopeBranchId,
  requiresOwnerApproval,
  writeAudit,
  enforcePlanLimit,
} from '@/lib/api-helpers'
import { menuItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/admin/menu/items
// STRICT branch scope: branch-assigned staff see ONLY their own branch's
// items — matching exactly what their branch's QR menu shows. Owners &
// super admins see everything (all branches + any restaurant-wide items).
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const branchId = scopeBranchId(user)
  const items = await db.menuItem.findMany({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      ...(branchId ? { branchId } : {}),
    },
    include: {
      category: true,
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
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
// Owners create items instantly — the item inherits the category's branch
// scope (shared category → shared item). Branch MANAGERS create items inside
// their own branch that stay PENDING until the owner approves them.
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

    // STRICT menu model: an item is always visible inside its category's
    // branch scope, so it must inherit the category's branch. Branch staff
    // may only file items under their own branch's categories — an item
    // filed under another branch's (or restaurant-wide) category would never
    // appear on their QR menu.
    const managerBranchId = scopeBranchId(user)
    if (managerBranchId && cat.branchId !== managerBranchId) {
      return fail(
        'You can only add items to your own branch categories. Create a category for your branch first.',
        403,
      )
    }
    const targetBranchId = cat.branchId
    if (targetBranchId) {
      const branch = await db.branch.findUnique({ where: { id: targetBranchId } })
      if (!branch || branch.restaurantId !== restaurantId) {
        return fail('Invalid branch — it does not belong to your restaurant.', 422)
      }
    }

    // Plan limit enforcement
    const limitErr = await enforcePlanLimit(restaurantId, 'maxMenuItems')
    if (limitErr) return limitErr

    const pending = requiresOwnerApproval(user.role as string)
    const item = await db.menuItem.create({
      data: {
        restaurantId,
        branchId: targetBranchId,
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
        approvalStatus: pending ? 'PENDING' : 'APPROVED',
        requestedById: pending ? user.id : null,
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
        category: true,
        branch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        variants: true,
        modifierGroups: { include: { modifiers: true } },
      },
    })
    writeAudit(user, 'CREATE', 'MENU_ITEM', item.id, {
      name: item.name,
      branchId: targetBranchId,
      approvalStatus: item.approvalStatus,
    })
    return ok(item, 201)
  } catch (err: any) {
    console.error('[menu-items POST] unhandled error:', err)
    return fail(
      `Failed to create item: ${err.message || 'Unknown error'}. Please try again.`,
      500,
    )
  }
}
