import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  blocked: z.boolean(),
  reason: z.string().max(280).optional(),
})

// POST /api/platform/restaurants/[id]/block-qr
// Body: { blocked: boolean, reason?: string }
//
// When blocked=true, customers cannot scan QR codes to place orders at this
// restaurant. The customer menu route and order route both check the
// `platformFeeBlocked` flag and reject requests when it's true.
//
// Typically used when a restaurant has overdue platform fees (pending for
// more than 30 days). The super admin can unblock once fees are settled.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    requireSuperAdmin(session)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.restaurant.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: any
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
  const { blocked, reason } = parsed.data

  const updated = await db.restaurant.update({
    where: { id },
    data: {
      platformFeeBlocked: blocked,
      platformFeeBlockedAt: blocked ? new Date() : null,
      platformFeeBlockReason: blocked ? reason || 'Overdue platform fees' : null,
    },
  })

  await db.auditLog.create({
    data: {
      restaurantId: id,
      userId: (session.user as any).id,
      action: blocked ? 'BLOCK_QR' : 'UNBLOCK_QR',
      entity: 'RESTAURANT',
      entityId: id,
      details: JSON.stringify({ reason: reason || null }),
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      id: updated.id,
      platformFeeBlocked: updated.platformFeeBlocked,
      platformFeeBlockedAt: updated.platformFeeBlockedAt,
      platformFeeBlockReason: updated.platformFeeBlockReason,
    },
  })
}
