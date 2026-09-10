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
import { menuCategorySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/admin/menu/categories
// STRICT branch scope: branch-assigned staff (manager, kitchen, …) see ONLY
// their own branch's categories — matching exactly what their branch's QR
// menu shows. Owners & super admins see everything (all branches + any
// restaurant-wide categories).
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const branchId = scopeBranchId(user)
  const categories = await db.menuCategory.findMany({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      ...(branchId ? { branchId } : {}),
    },
    orderBy: { sortOrder: 'asc' },
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      _count: { select: { menuItems: true } },
    },
  })
  return ok(categories)
}

// POST /api/admin/menu/categories
// Owners create categories instantly (restaurant-wide or for a chosen
// branch). Branch MANAGERS create branch categories that stay PENDING until
// the owner approves them.
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

    // Branch scope: a branch manager ALWAYS creates inside their own branch;
    // owners may pass a branchId (or omit it for a restaurant-wide category).
    const managerBranchId = scopeBranchId(user)
    let targetBranchId: string | null = managerBranchId || (body as any)?.branchId || null
    if (targetBranchId) {
      const branch = await db.branch.findUnique({ where: { id: targetBranchId } })
      if (!branch || branch.restaurantId !== restaurantId) {
        return fail('Invalid branch — it does not belong to your restaurant.', 422)
      }
    }

    const pending = requiresOwnerApproval(user.role as string)
    const maxSort = await db.menuCategory.aggregate({
      where: { restaurantId },
      _max: { sortOrder: true },
    })
    const category = await db.menuCategory.create({
      data: {
        restaurantId,
        branchId: targetBranchId,
        name: data.name,
        description: data.description || null,
        icon: data.icon || null,
        sortOrder: data.sortOrder ?? (maxSort._max.sortOrder || 0) + 1,
        active: data.active ?? true,
        approvalStatus: pending ? 'PENDING' : 'APPROVED',
        requestedById: pending ? user.id : null,
      },
      include: {
        branch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        _count: { select: { menuItems: true } },
      },
    })
    writeAudit(user, 'CREATE', 'MENU_CATEGORY', category.id, {
      name: category.name,
      branchId: targetBranchId,
      approvalStatus: category.approvalStatus,
    })
    return ok(category, 201)
  } catch (err: any) {
    console.error('[categories POST] unhandled error:', err)
    return fail(
      `Failed to create category: ${err.message || 'Unknown error'}. Please try again.`,
      500,
    )
  }
}
