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
  generateToken,
  enforcePlanLimit,
} from '@/lib/api-helpers'
import { tableSchema } from '@/lib/validations'
import { slugifyTokenPrefix } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

/**
 * Validate that a branchId (if provided) belongs to the caller's restaurant.
 * Returns a fail() response on mismatch, or null when OK.
 */
async function validateBranch(restaurantId: string, branchId?: string | null) {
  if (!branchId) return null
  const branch = await db.branch.findUnique({ where: { id: branchId } })
  if (!branch || branch.restaurantId !== restaurantId) {
    return fail('Invalid branch — it does not belong to your restaurant.', 422)
  }
  return null
}

// GET /api/admin/tables
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const sp = req.nextUrl.searchParams
  const restaurantId = scopeRestaurantId(user, sp.get('restaurantId'))
  // Branch-scoped staff only manage their own branch's tables.
  const staffBranchId = scopeBranchId(user)
  // Owners & super admins can FILTER the list branch-wise via ?branchId=:
  //   ?branchId=<id>  → only that branch's tables (and their QR codes)
  //   ?branchId=none  → restaurant-wide tables without a branch
  //   ?branchId=all   → everything (default, backward compatible)
  // The param is ignored for branch-scoped staff — the server always wins.
  let ownerBranchFilter: string | null | undefined
  if (!staffBranchId) {
    const view = sp.get('branchId')
    if (view && view !== 'all') {
      if (view === 'none') {
        ownerBranchFilter = null
      } else {
        const branch = await db.branch.findUnique({ where: { id: view } })
        if (!branch || (restaurantId && branch.restaurantId !== restaurantId)) {
          return fail('Invalid branch — it does not belong to your restaurant.', 422)
        }
        ownerBranchFilter = view
      }
    }
  }
  const tables = await db.table.findMany({
    where: {
      ...(restaurantId ? { restaurantId } : {}),
      ...(staffBranchId
        ? { branchId: staffBranchId }
        : ownerBranchFilter !== undefined
          ? { branchId: ownerBranchFilter }
          : {}),
    },
    orderBy: { number: 'asc' },
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      _count: { select: { orders: true } },
      orders: {
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          grandTotal: true,
          placedAt: true,
        },
        orderBy: { placedAt: 'desc' },
        take: 1,
      },
    },
  })
  return ok(tables)
}

// POST /api/admin/tables
export async function POST(req: NextRequest) {
  const { user, error } = await requirePermission('tables.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  if (user.role !== 'SUPER_ADMIN' && !user.restaurantId) {
    return fail('You are not assigned to a restaurant.', 400)
  }
  // Super admins operate on a tenant via ?restaurantId= (same as GET/PATCH/DELETE).
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('Super admin must pass ?restaurantId= of the target restaurant.', 400)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = tableSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data

  // Branch assignment must reference a branch of THIS restaurant.
  const branchErr = await validateBranch(restaurantId, data.branchId)
  if (branchErr) return branchErr

  // Uniqueness check on (restaurantId, number)
  const existing = await db.table.findUnique({
    where: { restaurantId_number: { restaurantId, number: data.number } },
  })
  if (existing) return fail(`Table ${data.number} already exists.`, 409)

  // Plan limit enforcement
  const limitErr = await enforcePlanLimit(restaurantId, 'maxTables')
  if (limitErr) return limitErr

  // Owner-approval workflow: tables created by a branch MANAGER stay PENDING
  // until the restaurant owner approves them from the Approvals centre.
  const pending = requiresOwnerApproval(user.role as string)

  const table = await db.table.create({
    data: {
      restaurantId,
      // A branch-scoped manager always creates tables inside their own branch,
      // even if the client omitted the field.
      branchId: scopeBranchId(user) || data.branchId || null,
      number: data.number,
      label: data.label || null,
      capacity: data.capacity,
      active: data.active ?? true,
      // Token prefix must be URL-safe: table numbers like "Medchal 01" or
      // "Med 009" contain spaces that break QR scanner → browser handoffs.
      // slugifyTokenPrefix turns them into "medchal-01" / "med-009".
      qrCodeToken: generateToken(`t-${slugifyTokenPrefix(data.number)}`),
      status: 'AVAILABLE',
      approvalStatus: pending ? 'PENDING' : 'APPROVED',
      requestedById: pending ? user.id : null,
    },
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  })
  writeAudit(user, 'CREATE', 'TABLE', table.id, {
    number: table.number,
    approvalStatus: table.approvalStatus,
  })
  return ok(table, 201)
}
