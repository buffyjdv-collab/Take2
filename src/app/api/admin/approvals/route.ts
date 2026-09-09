import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * Owner Approval Centre
 *
 * Every menu category, menu item, table and staff account created by a
 * BRANCH MANAGER lands here as PENDING. The RESTAURANT_OWNER reviews and
 * either approves (entity goes live / account activated) or rejects (with an
 * optional note the manager can see). Owners & super admins only.
 */

const ENTITY_TYPES = ['MENU_CATEGORY', 'MENU_ITEM', 'TABLE', 'STAFF'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

// GET /api/admin/approvals?status=PENDING|APPROVED|REJECTED|ALL&type=...
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('approvals.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) return ok({ requests: [], counts: {} })

  const sp = req.nextUrl.searchParams
  const status = (sp.get('status') || 'PENDING').toUpperCase()
  const typeFilter = (sp.get('type') || '').toUpperCase()
  const statusWhere =
    status === 'APPROVED' || status === 'REJECTED' || status === 'PENDING'
      ? { approvalStatus: status }
      : status === 'ALL'
      ? {}
      : { approvalStatus: 'PENDING' }

  const want = (t: string) => !typeFilter || typeFilter === 'ALL' || typeFilter === t

  const [cats, items, tables, staff] = await Promise.all([
    want('MENU_CATEGORY')
      ? db.menuCategory.findMany({
          where: { restaurantId, ...statusWhere },
          include: {
            branch: { select: { id: true, name: true } },
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
            _count: { select: { menuItems: true } },
          },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
    want('MENU_ITEM')
      ? db.menuItem.findMany({
          where: { restaurantId, ...statusWhere },
          include: {
            category: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
            variants: { select: { id: true } },
          },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
    want('TABLE')
      ? db.table.findMany({
          where: { restaurantId, ...statusWhere },
          include: {
            branch: { select: { id: true, name: true } },
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
    want('STAFF')
      ? db.user.findMany({
          where: { restaurantId, ...statusWhere, role: { not: 'SUPER_ADMIN' } },
          include: {
            branch: { select: { id: true, name: true } },
            requestedByUser: { select: { id: true, name: true } },
            reviewedByUser: { select: { id: true, name: true } },
          },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
  ])

  interface ApprovalRow {
    id: string
    entityType: EntityType
    title: string
    detail: string
    branchId: string | null
    branchName: string | null
    requestedByName: string | null
    createdAt: string
    status: string
    reviewNote: string | null
    reviewedByName: string | null
    reviewedAt: string | null
  }

  const rows: ApprovalRow[] = []

  for (const c of cats) {
    rows.push({
      id: c.id,
      entityType: 'MENU_CATEGORY',
      title: c.name,
      detail: `${c._count.menuItems} item(s) inside`,
      branchId: c.branchId,
      branchName: c.branch?.name || null,
      requestedByName: c.requestedBy?.name || null,
      createdAt: c.createdAt.toISOString(),
      status: c.approvalStatus,
      reviewNote: c.reviewNote,
      reviewedByName: c.reviewedBy?.name || null,
      reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null,
    })
  }
  for (const i of items) {
    rows.push({
      id: i.id,
      entityType: 'MENU_ITEM',
      title: i.name,
      detail: `₹${i.basePrice} · ${i.category?.name || 'Uncategorised'}${
        i.variants?.length ? ` · ${i.variants.length} variant(s)` : ''
      }`,
      branchId: i.branchId,
      branchName: i.branch?.name || null,
      requestedByName: i.requestedBy?.name || null,
      createdAt: i.createdAt.toISOString(),
      status: i.approvalStatus,
      reviewNote: i.reviewNote,
      reviewedByName: i.reviewedBy?.name || null,
      reviewedAt: i.reviewedAt ? i.reviewedAt.toISOString() : null,
    })
  }
  for (const t of tables) {
    rows.push({
      id: t.id,
      entityType: 'TABLE',
      title: `Table ${t.number}`,
      detail: `${t.capacity} seats${t.label ? ` · ${t.label}` : ''}`,
      branchId: t.branchId,
      branchName: t.branch?.name || null,
      requestedByName: t.requestedBy?.name || null,
      createdAt: t.createdAt.toISOString(),
      status: t.approvalStatus,
      reviewNote: t.reviewNote,
      reviewedByName: t.reviewedBy?.name || null,
      reviewedAt: t.reviewedAt ? t.reviewedAt.toISOString() : null,
    })
  }
  for (const s of staff) {
    rows.push({
      id: s.id,
      entityType: 'STAFF',
      title: s.name,
      detail: `${s.role.charAt(0)}${s.role.slice(1).toLowerCase()} · ${s.email}`,
      branchId: s.branchId,
      branchName: s.branch?.name || null,
      requestedByName: s.requestedByUser?.name || null,
      createdAt: s.createdAt.toISOString(),
      status: s.approvalStatus,
      reviewNote: s.reviewNote,
      reviewedByName: s.reviewedByUser?.name || null,
      reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    })
  }

  // counts per status (unfiltered by query params, for tab badges)
  const [pC, pI, pT, pS, rC, rI, rT, rS] = await Promise.all([
    db.menuCategory.count({ where: { restaurantId, approvalStatus: 'PENDING' } }),
    db.menuItem.count({ where: { restaurantId, approvalStatus: 'PENDING' } }),
    db.table.count({ where: { restaurantId, approvalStatus: 'PENDING' } }),
    db.user.count({ where: { restaurantId, approvalStatus: 'PENDING', role: { not: 'SUPER_ADMIN' } } }),
    db.menuCategory.count({ where: { restaurantId, approvalStatus: 'REJECTED' } }),
    db.menuItem.count({ where: { restaurantId, approvalStatus: 'REJECTED' } }),
    db.table.count({ where: { restaurantId, approvalStatus: 'REJECTED' } }),
    db.user.count({ where: { restaurantId, approvalStatus: 'REJECTED', role: { not: 'SUPER_ADMIN' } } }),
  ])

  const counts = {
    PENDING: {
      all: pC + pI + pT + pS,
      MENU_CATEGORY: pC,
      MENU_ITEM: pI,
      TABLE: pT,
      STAFF: pS,
    },
    REJECTED: {
      all: rC + rI + rT + rS,
      MENU_CATEGORY: rC,
      MENU_ITEM: rI,
      TABLE: rT,
      STAFF: rS,
    },
  }

  return ok({ requests: rows, counts })
}

// POST /api/admin/approvals
// Body: { entityType, entityId, action: 'APPROVE' | 'REJECT', note? }
export async function POST(req: NextRequest) {
  const { user, error } = await requirePermission('approvals.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const restaurantId = scopeRestaurantId(user, null)

  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const entityType: string = body?.entityType
  const entityId: string = body?.entityId
  const action: string = (body?.action || '').toUpperCase()
  const note: string | undefined = body?.note

  if (!ENTITY_TYPES.includes(entityType as EntityType)) {
    return fail('Unknown entityType.', 422)
  }
  if (!entityId) return fail('entityId is required.', 422)
  if (action !== 'APPROVE' && action !== 'REJECT') {
    return fail("action must be 'APPROVE' or 'REJECT'.", 422)
  }
  if (action === 'REJECT' && note !== undefined && note.length > 500) {
    return fail('Rejection note is too long (max 500 chars).', 422)
  }

  const reviewData = {
    approvalStatus: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    reviewedById: user.id,
    reviewedAt: new Date(),
    reviewNote: action === 'REJECT' ? note?.trim() || 'Not approved by owner' : null,
  }

  switch (entityType as EntityType) {
    case 'MENU_CATEGORY': {
      const cat = await db.menuCategory.findUnique({ where: { id: entityId } })
      if (!cat || (restaurantId && cat.restaurantId !== restaurantId)) {
        return fail('Category not found.', 404)
      }
      await db.menuCategory.update({ where: { id: entityId }, data: reviewData })
      break
    }
    case 'MENU_ITEM': {
      const item = await db.menuItem.findUnique({ where: { id: entityId } })
      if (!item || (restaurantId && item.restaurantId !== restaurantId)) {
        return fail('Menu item not found.', 404)
      }
      await db.menuItem.update({ where: { id: entityId }, data: reviewData })
      break
    }
    case 'TABLE': {
      const table = await db.table.findUnique({ where: { id: entityId } })
      if (!table || (restaurantId && table.restaurantId !== restaurantId)) {
        return fail('Table not found.', 404)
      }
      await db.table.update({ where: { id: entityId }, data: reviewData })
      break
    }
    case 'STAFF': {
      const target = await db.user.findUnique({ where: { id: entityId } })
      if (!target || (restaurantId && target.restaurantId !== restaurantId)) {
        return fail('Staff member not found.', 404)
      }
      if (target.role === 'SUPER_ADMIN' || target.role === 'RESTAURANT_OWNER') {
        return fail('Owners do not need approval.', 422)
      }
      await db.user.update({
        where: { id: entityId },
        data: {
          // User model uses the staff-approval field names (self-relation FKs).
          approvalStatus: reviewData.approvalStatus,
          reviewedStaffById: user.id,
          reviewedAt: reviewData.reviewedAt,
          reviewNote: reviewData.reviewNote,
          // Approval activates the account; rejection keeps it locked out.
          active: action === 'APPROVE',
        },
      })
      break
    }
  }

  writeAudit(user, action === 'APPROVE' ? 'APPROVE' : 'REJECT', entityType, entityId, {
    note: reviewData.reviewNote,
  })
  return ok({ id: entityId, entityType, status: reviewData.approvalStatus })
}
