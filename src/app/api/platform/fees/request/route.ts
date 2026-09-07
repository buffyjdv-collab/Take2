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
  amount: z.number().positive('amount must be positive'),
  dueDate: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
})

/**
 * POST /api/platform/fees/request
 *
 * Super admin sends a payment request to a tenant for their accumulated
 * platform fees. Creates a PlatformFeePaymentRequest with status PENDING.
 * Fires a `platform:feeRequested` realtime event to the tenant.
 *
 * Body:
 *   {
 *     restaurantId: string,
 *     amount: number,         // rupees
 *     dueDate?: string,       // ISO 8601
 *     note?: string,
 *   }
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
  const { restaurantId, amount, dueDate, note } = parsed.data

  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true },
  })
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 })
  }

  const request = await db.platformFeePaymentRequest.create({
    data: {
      restaurantId,
      amount,
      dueDate: dueDate ? new Date(dueDate) : null,
      note: note || null,
      sentAt: new Date(),
    },
  })

  await db.auditLog.create({
    data: {
      restaurantId,
      userId: (session.user as any).id,
      action: 'CREATE',
      entity: 'PLATFORM_FEE_PAYMENT_REQUEST',
      entityId: request.id,
      details: JSON.stringify({ amount, dueDate: dueDate || null, note: note || null }),
    },
  })

  // Notify the tenant in real-time
  publishRealtime('platform:feeRequested', {
    restaurantId,
    payload: {
      requestId: request.id,
      amount,
      dueDate: dueDate || null,
      note: note || null,
      restaurantName: restaurant.name,
      sentAt: request.sentAt.toISOString(),
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      id: request.id,
      restaurantId: request.restaurantId,
      amount: request.amount,
      dueDate: request.dueDate?.toISOString() ?? null,
      note: request.note,
      status: request.status,
      sentAt: request.sentAt.toISOString(),
    },
  })
}
