import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/fees/payments
 *
 * Super admin view of all platform fee payments across all tenants.
 * Returns all PlatformFeePayment rows with restaurant info, sorted by
 * createdAt desc. Supports optional filters:
 *   ?status=PAID|PROCESSING|PENDING|COLLECTED_DIRECT|FAILED|REFUNDED
 *   ?restaurantId=<id>    // filter by tenant
 *   ?take=50&skip=0        // pagination
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    requireSuperAdmin(session)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') || undefined
  const restaurantId = sp.get('restaurantId') || undefined
  const take = Math.min(parseInt(sp.get('take') || '50', 10), 200)
  const skip = parseInt(sp.get('skip') || '0', 10)

  const where: any = {}
  if (status) where.status = status
  if (restaurantId) where.restaurantId = restaurantId

  const [payments, total] = await Promise.all([
    db.platformFeePayment.findMany({
      where,
      include: {
        restaurant: { select: { id: true, name: true, slug: true, plan: true } },
        verifiedBy: { select: { id: true, name: true } },
        request: { select: { id: true, amount: true, status: true, sentAt: true } },
        _count: { select: { coveredFees: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    db.platformFeePayment.count({ where }),
  ])

  return NextResponse.json({
    success: true,
    data: payments.map((p) => ({
      id: p.id,
      restaurantId: p.restaurantId,
      restaurant: p.restaurant,
      amount: p.amount,
      method: p.method,
      status: p.status,
      provider: p.provider,
      providerTxnId: p.providerTxnId,
      note: p.note,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      verifiedBy: p.verifiedBy,
      request: p.request,
      feesCovered: p._count.coveredFees,
      createdAt: p.createdAt.toISOString(),
    })),
    total,
    take,
    skip,
  })
}
