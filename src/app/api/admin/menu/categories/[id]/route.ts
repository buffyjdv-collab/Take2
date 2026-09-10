import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  scopeBranchId,
  canActOnBranch,
  writeAudit,
} from '@/lib/api-helpers'
import { menuCategorySchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

async function getCategoryOr404(id: string, restaurantId: string | null) {
  const cat = await db.menuCategory.findUnique({ where: { id } })
  if (!cat) return null
  if (restaurantId && cat.restaurantId !== restaurantId) return null
  return cat
}

// PATCH /api/admin/menu/categories/[id]
//
// Approval rules:
//  - Owners / super admins edit freely; their edits keep the category live.
//  - Branch managers may only edit categories of THEIR OWN branch; any
//    content change sends the category back to PENDING for owner review.
//  - Nobody but the manager's owner chain can touch restaurant-wide
//    (branchId = null) categories from a branch account.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('menu.update')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const cat = await getCategoryOr404(id, restaurantId)
  if (!cat) return fail('Category not found.', 404)

  // Branch-scoped managers can only touch their own branch's categories.
  if (!canActOnBranch(user, cat.branchId)) return fail('Category not found.', 404)
  const isManager = user.role === 'MANAGER'

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = menuCategorySchema.partial().safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  const updated = await db.menuCategory.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined
        ? { description: data.description || null }
        : {}),
      ...(data.icon !== undefined ? { icon: data.icon || null } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      // Manager edits re-enter the owner-approval queue.
      ...(isManager
        ? { approvalStatus: 'PENDING', requestedById: user.id, reviewNote: null, reviewedAt: null, reviewedById: null }
        : {}),
    },
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      _count: { select: { menuItems: true } },
    },
  })
  writeAudit(user, 'UPDATE', 'MENU_CATEGORY', id, {
    ...parsed.data,
    ...(isManager ? { resubmittedForApproval: true } : {}),
  })
  return ok(updated)
}

// DELETE /api/admin/menu/categories/[id]
//
// Permission: MENU_CATEGORY.DELETE (granular RBAC — super admin / owner /
// manager by default; tunable per-role in the platform RBAC manager).
// A category with menu items is refused — move or delete its items first.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('MENU_CATEGORY.DELETE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const cat = await getCategoryOr404(id, restaurantId)
  if (!cat) return fail('Category not found.', 404)
  // Branch-scoped managers can only delete their own branch's categories.
  if (!canActOnBranch(user, cat.branchId)) return fail('Category not found.', 404)
  // Check for menu items — refuse delete if items exist
  const itemCount = await db.menuItem.count({ where: { categoryId: id } })
  if (itemCount > 0) {
    return fail(
      `Cannot delete category with ${itemCount} item(s). Move items to another category first.`,
      409,
    )
  }
  await db.menuCategory.delete({ where: { id } })
  writeAudit(user, 'DELETE', 'MENU_CATEGORY', id, { name: cat.name })
  return ok({ deleted: true })
}
