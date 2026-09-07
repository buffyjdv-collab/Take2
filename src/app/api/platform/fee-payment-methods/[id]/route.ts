import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  description: z.string().max(200).optional(),
  icon: z.string().max(50).optional(),
  accentColor: z.string().max(20).optional(),
  priority: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

/**
 * PATCH /api/platform/fee-payment-methods/[id]
 *
 * Super admin edits an existing platform payment method. Tenants get 403.
 */
export async function PATCH(
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
  const existing = await db.platformPaymentMethod.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid input.' },
      { status: 422 },
    )
  }
  const data: any = {}
  if (parsed.data.label !== undefined) data.label = parsed.data.label
  if (parsed.data.description !== undefined) data.description = parsed.data.description || null
  if (parsed.data.icon !== undefined) data.icon = parsed.data.icon || null
  if (parsed.data.accentColor !== undefined) data.accentColor = parsed.data.accentColor
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority
  if (parsed.data.active !== undefined) data.active = parsed.data.active
  if (parsed.data.config !== undefined) data.config = JSON.stringify(parsed.data.config)

  const updated = await db.platformPaymentMethod.update({
    where: { id },
    data,
  })

  return NextResponse.json({ success: true, data: updated })
}

/**
 * DELETE /api/platform/fee-payment-methods/[id]
 *
 * Super admin deletes a platform payment method. Tenants get 403.
 */
export async function DELETE(
  _req: NextRequest,
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
  const existing = await db.platformPaymentMethod.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  await db.platformPaymentMethod.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
