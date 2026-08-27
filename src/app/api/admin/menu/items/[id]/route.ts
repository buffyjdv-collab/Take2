import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
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
  }

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
        variants: { orderBy: { sortOrder: 'asc' } },
        modifierGroups: {
          include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
  })

  writeAudit(user, 'UPDATE', 'MENU_ITEM', id, data)
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
