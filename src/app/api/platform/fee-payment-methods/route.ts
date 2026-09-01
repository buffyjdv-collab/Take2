import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  type: z.enum(['UPI', 'QR', 'CARD', 'WALLET', 'NETBANKING']),
  label: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  icon: z.string().max(50).optional(),
  accentColor: z.string().max(20).optional(),
  priority: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

/**
 * GET /api/platform/fee-payment-methods
 *
 * Returns the platform's configured payment methods (the super admin's
 * own payment config). These are the payment options shown to tenants
 * when they pay their platform fees.
 *
 * For super admin: returns full config (including provider keys for the
 * edit UI).
 * For tenants (RESTAURANT_OWNER / MANAGER): returns only the methods with
 * `active: true` and only the `upiId` (for UPI/QR) — no provider secrets.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = (session.user as any).role as string
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isActiveFilter = isSuperAdmin ? {} : { active: true }

  const methods = await db.platformPaymentMethod.findMany({
    where: isActiveFilter,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })

  const data = methods.map((m) => {
    const config = m.config ? JSON.parse(m.config) : {}
    if (isSuperAdmin) {
      return { ...m, config }
    }
    // Tenant view — only expose the upiId for UPI/QR, redact provider keys
    return {
      id: m.id,
      type: m.type,
      label: m.label,
      description: m.description,
      icon: m.icon,
      accentColor: m.accentColor,
      priority: m.priority,
      active: m.active,
      config: ['UPI', 'QR'].includes(m.type)
        ? { upiId: config.upiId }
        : { provider: config.provider },
    }
  })

  return NextResponse.json({ success: true, data })
}

/**
 * POST /api/platform/fee-payment-methods
 *
 * Super admin creates a new platform payment method. Tenants get 403.
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
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid input.' },
      { status: 422 },
    )
  }
  const { type, label, description, icon, accentColor, priority, active, config } =
    parsed.data

  const method = await db.platformPaymentMethod.create({
    data: {
      type,
      label,
      description: description || null,
      icon: icon || null,
      accentColor: accentColor || '#EA580C',
      priority: priority ?? 10,
      active: active ?? true,
      config: config ? JSON.stringify(config) : null,
    },
  })

  await db.auditLog.create({
    data: {
      userId: (session.user as any).id,
      action: 'CREATE',
      entity: 'PLATFORM_PAYMENT_METHOD',
      entityId: method.id,
      details: JSON.stringify({ type, label }),
    },
  })

  return NextResponse.json({ success: true, data: method })
}
