import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  canActOnBranch,
  writeAudit,
} from '@/lib/api-helpers'
import { menuItemSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

async function getItemOr404(id: string, restaurantId: string | null) {
  const item = await db.menuItem.findUnique({
    where: { id },
    include: { variants: true, modifierGroups: true },
  })
  if (!item) return null
  if (restaurantId && item.restaurantId !== restaurantId) return null
  return item
}

// Content fields change what the customer sees/pays — when a BRANCH MANAGER
// edits any of these the item goes back to PENDING for owner approval.
// Operational toggles (available / soldOut) stay with the manager so they can
// run day-to-day service without waiting for the owner.
const CONTENT_FIELDS = [
  'name',
  'description',
  'image',
  'categoryId',
  'isVeg',
  'isSpicy',
  'basePrice',
  'taxRate',
  'isFeatured',
  'isPopular',
  'prepTime',
  'tags',
  'variants',
  'modifierGroupIds',
] as const

// GET /api/admin/menu/items/[id]
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const item = await getItemOr404(id, restaurantId)
  if (!item) return fail('Menu item not found.', 404)
  if (!canActOnBranch(user, item.branchId)) return fail('Menu item not found.', 404)
  return ok(item)
}

// PATCH /api/admin/menu/items/[id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
  const { user, error } = await requirePermission('menu.update')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const item = await getItemOr404(id, restaurantId)
  if (!item) return fail('Menu item not found.', 404)
  // Branch-scoped managers can only touch their own branch's items.
  if (!canActOnBranch(user, item.branchId)) return fail('Menu item not found.', 404)
  const isManager = user.role === 'MANAGER'

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = menuItemSchema.partial().safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // Validate category if provided
  if (data.categoryId) {
    const cat = await db.menuCategory.findUnique({ where: { id: data.categoryId } })
    if (!cat || cat.restaurantId !== item.restaurantId) {
      return fail('Invalid category.', 422)
    }
    // Managers can only move items within shared / own-branch categories.
    if (isManager && cat.branchId && cat.branchId !== item.branchId) {
      return fail('You can only move items to your own branch or shared categories.', 403)
    }
  }

  // Manager content edits re-enter the owner-approval queue.
  const touchesContent = isManager && CONTENT_FIELDS.some((f) => (data as any)[f] !== undefined)

  // Sync variants: simplistic upsert + delete missing
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.menuItem.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description || null }
          : {}),
        ...(data.image !== undefined ? { image: data.image || null } : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.isVeg !== undefined ? { isVeg: data.isVeg } : {}),
        ...(data.isSpicy !== undefined ? { isSpicy: data.isSpicy } : {}),
        ...(data.basePrice !== undefined ? { basePrice: data.basePrice } : {}),
        ...(data.taxRate !== undefined ? { taxRate: data.taxRate } : {}),
        ...(data.available !== undefined ? { available: data.available } : {}),
        ...(data.soldOut !== undefined ? { soldOut: data.soldOut } : {}),
        ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {}),
        ...(data.isPopular !== undefined ? { isPopular: data.isPopular } : {}),
        ...(data.prepTime !== undefined ? { prepTime: data.prepTime } : {}),
        ...(data.tags !== undefined ? { tags: data.tags || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(touchesContent
          ? {
              approvalStatus: 'PENDING',
              requestedById: user.id,
              reviewNote: null,
              reviewedAt: null,
              reviewedById: null,
            }
          : {}),
      },
    })

    // Variants sync
    if (data.variants) {
      const incomingIds = new Set(
        data.variants.filter((v) => v.id).map((v) => v.id as string),
      )
      // Delete removed
      await tx.menuVariant.deleteMany({
        where: {
          menuItemId: id,
          ...(incomingIds.size > 0 ? { id: { notIn: Array.from(incomingIds) } } : {}),
        },
      })
      // Upsert
      for (let idx = 0; idx < data.variants.length; idx++) {
        const v = data.variants[idx]
        if (v.id) {
          await tx.menuVariant.update({
            where: { id: v.id },
            data: {
              name: v.name,
              priceModifier: v.priceModifier,
              isDefault: v.isDefault ?? false,
              sortOrder: v.sortOrder ?? idx,
            },
          })
        } else {
          await tx.menuVariant.create({
            data: {
              menuItemId: id,
              name: v.name,
              priceModifier: v.priceModifier,
              isDefault: v.isDefault ?? false,
              sortOrder: v.sortOrder ?? idx,
            },
          })
        }
      }
    }

    // Modifier groups connect
    if (data.modifierGroupIds) {
      await tx.menuItem.update({
        where: { id },
        data: {
          modifierGroups: { set: [] },
        },
      })
      if (data.modifierGroupIds.length > 0) {
        await tx.menuItem.update({
          where: { id },
          data: {
            modifierGroups: {
              connect: data.modifierGroupIds.map((gid) => ({ id: gid })),
            },
          },
        })
      }
    }

    return tx.menuItem.findUnique({
      where: { id },
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
    })
  })

  writeAudit(user, 'UPDATE', 'MENU_ITEM', id, {
    ...data,
    ...(touchesContent ? { resubmittedForApproval: true } : {}),
  })
  return ok(updated)
  } catch (err: any) {
    console.error('[menu-items PATCH] unhandled error:', err)
    return fail(
      `Failed to update item: ${err.message || 'Unknown error'}. Please try again.`,
      500,
    )
  }
}

// DELETE /api/admin/menu/items/[id]
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('menu.delete')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const item = await getItemOr404(id, restaurantId)
  if (!item) return fail('Menu item not found.', 404)
  // Branch-scoped managers can only delete their own branch's items.
  if (!canActOnBranch(user, item.branchId)) return fail('Menu item not found.', 404)

  // Check if used in any orders
  const used = await db.orderItem.count({ where: { menuItemId: id } })
  if (used > 0) {
    // Soft delete — mark unavailable + sold out
    const updated = await db.menuItem.update({
      where: { id },
      data: { available: false, soldOut: true },
    })
    writeAudit(user, 'DELETE', 'MENU_ITEM', id, { soft: true, usedInOrders: used })
    return ok({ softDeleted: true, item: updated })
  }
  await db.menuItem.delete({ where: { id } })
  writeAudit(user, 'DELETE', 'MENU_ITEM', id, { name: item.name })
  return ok({ deleted: true })
}
