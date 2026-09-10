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
import { tableSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

async function getTableOr404(id: string, restaurantId: string | null) {
  const t = await db.table.findUnique({ where: { id } })
  if (!t) return null
  if (restaurantId && t.restaurantId !== restaurantId) return null
  return t
}

// PATCH /api/admin/tables/[id]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('tables.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const table = await getTableOr404(id, restaurantId)
  if (!table) return fail('Table not found.', 404)
  // Branch-scoped staff can only touch tables of their own branch.
  if (!canActOnBranch(user, table.branchId)) return fail('Table not found.', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = tableSchema.partial().safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // Branch re-assignment must reference a branch of THIS restaurant, and a
  // branch-scoped manager cannot move a table out of their branch.
  if (data.branchId !== undefined) {
    const targetBranchId = scopeBranchId(user) || data.branchId || null
    if (targetBranchId) {
      const branch = await db.branch.findUnique({ where: { id: targetBranchId } })
      if (!branch || branch.restaurantId !== table.restaurantId) {
        return fail('Invalid branch — it does not belong to your restaurant.', 422)
      }
    }
    data.branchId = targetBranchId
  }

  // If number changed, ensure uniqueness
  if (data.number && data.number !== table.number) {
    const existing = await db.table.findUnique({
      where: {
        restaurantId_number: {
          restaurantId: table.restaurantId,
          number: data.number,
        },
      },
    })
    if (existing) return fail(`Table ${data.number} already exists.`, 409)
  }

  // Owner-approval workflow: content edits (number / label / capacity / branch
  // move) by a branch MANAGER send the table back to PENDING. The active
  // toggle stays operational so managers can open/close a table day-to-day.
  const isManager = user.role === 'MANAGER'
  const touchesContent =
    isManager &&
    (data.number !== undefined ||
      data.label !== undefined ||
      data.capacity !== undefined ||
      data.branchId !== undefined)

  const updated = await db.table.update({
    where: { id },
    data: {
      ...(data.number !== undefined ? { number: data.number } : {}),
      ...(data.label !== undefined ? { label: data.label || null } : {}),
      ...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.branchId !== undefined ? { branchId: data.branchId || null } : {}),
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
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  })
  writeAudit(user, 'UPDATE', 'TABLE', id, {
    ...data,
    ...(touchesContent ? { resubmittedForApproval: true } : {}),
  })
  return ok(updated)
}

// DELETE /api/admin/tables/[id]
//
// Permission: TABLE.DELETE (granular RBAC — super admin / owner / manager by
// default; tunable per-role in the platform RBAC manager).
//
// Safety: Order.table and ServiceRequest.table use onDelete: SetNull, so
// deleting a table PRESERVES its order history (orders keep their financial
// data with tableId = null). Any unexpected FK blocker returns a friendly 409.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('TABLE.DELETE')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const table = await getTableOr404(id, restaurantId)
  if (!table) return fail('Table not found.', 404)
  // Branch-scoped staff can only delete tables of their own branch.
  if (!canActOnBranch(user, table.branchId)) return fail('Table not found.', 404)
  try {
    await db.table.delete({ where: { id } })
  } catch (e: unknown) {
    // P2003 = foreign key constraint — some record still references the table.
    if ((e as { code?: string })?.code === 'P2003') {
      return fail(
        'This table cannot be deleted because other records still reference it. Deactivate it instead.',
        409,
      )
    }
    throw e
  }
  writeAudit(user, 'DELETE', 'TABLE', id, { number: table.number })
  return ok({ deleted: true })
}
