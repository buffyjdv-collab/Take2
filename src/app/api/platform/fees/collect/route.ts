import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { publishRealtime } from '@/lib/realtime-server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  restaurantId: z.string().min(1, 'restaurantId is required'),
  amount: z.number().positive('amount must be positive').optional(),
  note: z.string().max(500).optional(),
  // If true, only collect fees up to `amount`; otherwise collect all PENDING
  // fees. Defaults to false (collect all).
  partial: z.boolean().optional(),
})

/**
 * POST /api/platform/fees/collect
 *
 * Super admin manually marks a tenant's PENDING platform fees as
 * COLLECTED_DIRECT — used for offline settlements (cash, bank transfer,
 * etc.) where there's no in-app payment to verify.
 *
 * Creates a PlatformFeePayment row with status=COLLECTED_DIRECT and
 * method=MANUAL, links the covered fees via PlatformFeeCoveredEntry, and
 * marks those fees' status as COLLECTED with collectedAt=now.
 *
 * If `amount` is provided and `partial=false` (default), the admin
 * requests a specific amount — the system picks PENDING fees to cover
 * (oldest first) until the requested amount is reached or all are
 * covered. If `partial=true`, only the specified amount is collected and
 * the remaining fees stay PENDING.
 *
 * If `amount` is omitted, ALL PENDING fees are collected.
 *
 * Fires `platform:feeCollected` (per fee) + `platform:feePaid` (lump sum)
 * realtime events.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    requireSuperAdmin(session)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid input.' },
      { status: 422 },
    )
  }
  const { restaurantId, amount, note, partial } = parsed.data

  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true },
  })
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 })
  }

  // Get all PENDING fees for this restaurant (oldest first)
  const pendingFees = await db.platformFee.findMany({
    where: { restaurantId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, feeAmount: true, createdAt: true },
  })

  if (pendingFees.length === 0) {
    return NextResponse.json(
      { error: 'No pending platform fees to collect.' },
      { status: 400 },
    )
  }

  // Pick which fees to cover
  let coveredFeeIds: string[] = []
  let coveredAmount = 0
  if (!amount) {
    // Collect ALL pending fees
    coveredFeeIds = pendingFees.map((f) => f.id)
    coveredAmount = pendingFees.reduce((s, f) => s + f.feeAmount, 0)
  } else {
    // Pick oldest fees until we reach `amount` (or run out)
    let running = 0
    for (const f of pendingFees) {
      if (running + f.feeAmount > amount && !partial) {
        // If not partial, we stop at the last fee that fits exactly
        if (Math.abs(running - amount) < 0.01) break
      }
      coveredFeeIds.push(f.id)
      running += f.feeAmount
      if (amount && running >= amount) break
    }
    coveredAmount = running
  }

  const collectedAt = new Date()

  // Create the PlatformFeePayment record (status COLLECTED_DIRECT — offline
  // settlement, no gateway verification needed)
  const payment = await db.platformFeePayment.create({
    data: {
      restaurantId,
      amount: +coveredAmount.toFixed(2),
      method: 'MANUAL',
      status: 'COLLECTED_DIRECT',
      provider: 'MANUAL',
      verifiedAt: collectedAt,
      verifiedById: (session.user as any).id,
      note: note || 'Manual collection by super admin',
    },
  })

  // Link covered fees + mark them as COLLECTED
  if (coveredFeeIds.length > 0) {
    await db.platformFeeCoveredEntry.createMany({
      data: coveredFeeIds.map((feeId) => ({
        paymentId: payment.id,
        platformFeeId: feeId,
      })),
    })

    await db.platformFee.updateMany({
      where: { id: { in: coveredFeeIds } },
      data: { status: 'COLLECTED', collectedAt },
    })
  }

  await db.auditLog.create({
    data: {
      restaurantId,
      userId: (session.user as any).id,
      action: 'COLLECT_PLATFORM_FEES',
      entity: 'PLATFORM_FEE_PAYMENT',
      entityId: payment.id,
      details: JSON.stringify({
        amount: coveredAmount,
        feeCount: coveredFeeIds.length,
        note: note || null,
      }),
    },
  })

  // Realtime: per-fee COLLECTED + lump-sum PAID
  for (const feeId of coveredFeeIds) {
    publishRealtime('platform:feeCollected', {
      restaurantId,
      payload: { feeId, paymentId: payment.id, collectedAt: collectedAt.toISOString() },
    })
  }
  publishRealtime('platform:feePaid', {
    restaurantId,
    payload: {
      paymentId: payment.id,
      amount: coveredAmount,
      method: 'MANUAL',
      status: 'COLLECTED_DIRECT',
      feeCount: coveredFeeIds.length,
      restaurantName: restaurant.name,
      paidAt: collectedAt.toISOString(),
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      paymentId: payment.id,
      restaurantId,
      amount: coveredAmount,
      method: 'MANUAL',
      status: 'COLLECTED_DIRECT',
      feesCovered: coveredFeeIds.length,
      collectedAt: collectedAt.toISOString(),
    },
  })
}
