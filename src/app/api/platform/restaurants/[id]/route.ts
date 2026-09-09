import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { platformUpdateTenantSchema } from '@/lib/validations'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/** Get a single tenant with full details. */
export async function GET(
  _req: Request,
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
  const restaurant = await db.restaurant.findUnique({
    where: { id },
    include: {
      subscription: true,
      settings: true,
      branches: true,
      users: {
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      },
      _count: {
        select: {
          tables: true,
          menuItems: true,
          orders: true,
          customers: true,
          invoices: true,
        },
      },
    },
  })

  if (!restaurant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Last 30 days metrics
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const recentOrders = await db.order.findMany({
    where: { restaurantId: id, placedAt: { gte: thirtyDaysAgo } },
    select: { grandTotal: true, status: true, paymentStatus: true, placedAt: true },
  })
  const revenue = recentOrders
    .filter((o) => o.paymentStatus === 'PAID')
    .reduce((sum, o) => sum + o.grandTotal, 0)

  return NextResponse.json({
    success: true,
    data: {
      ...restaurant,
      metrics: {
        last30Days: {
          orders: recentOrders.length,
          revenue,
          paid: recentOrders.filter((o) => o.paymentStatus === 'PAID').length,
          cancelled: recentOrders.filter((o) => o.status === 'CANCELLED').length,
        },
      },
    },
  })
}

/** Update tenant details (plan, status, suspension, etc). */
export async function PATCH(
  req: Request,
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
  try {
    const body = await req.json()
    const parsed = platformUpdateTenantSchema.parse(body)

    const existing = await db.restaurant.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Determine new suspension state
    let suspendedAt: Date | null = existing.suspendedAt
    let suspendedReason: string | null = existing.suspendedReason
    if (parsed.subscriptionStatus === 'SUSPENDED' && !existing.suspendedAt) {
      suspendedAt = new Date()
      suspendedReason = parsed.suspendReason || 'Suspended by platform admin'
    } else if (parsed.subscriptionStatus && parsed.subscriptionStatus !== 'SUSPENDED') {
      suspendedAt = null
      suspendedReason = null
    }

    const updated = await db.restaurant.update({
      where: { id },
      data: {
        name: parsed.name,
        tagline: parsed.tagline,
        address: parsed.address,
        city: parsed.city,
        phone: parsed.phone,
        email: parsed.email,
        isOpen: parsed.isOpen,
        plan: parsed.plan,
        subscriptionStatus: parsed.subscriptionStatus,
        suspendedAt,
        suspendedReason,
      },
    })

    // Sync subscription if plan changed
    if (parsed.plan) {
      const sub = await db.subscription.findUnique({ where: { restaurantId: id } })
      if (sub) {
        await db.subscription.update({
          where: { restaurantId: id },
          data: {
            plan: parsed.plan,
            status: parsed.subscriptionStatus || sub.status,
          },
        })
      } else {
        await db.subscription.create({
          data: {
            restaurantId: id,
            plan: parsed.plan,
            status: parsed.subscriptionStatus || 'ACTIVE',
            billingCycle: 'MONTHLY',
            amount: 0,
            currency: 'INR',
          },
        })
      }
    }

    // Audit
    await db.auditLog.create({
      data: {
        restaurantId: id,
        userId: (session.user as any).id,
        action: 'UPDATE',
        entity: 'RESTAURANT',
        entityId: id,
        details: JSON.stringify(parsed),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    }
    console.error('[platform/restaurants/:id] error:', err)
    return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 })
  }
}

/** Soft-delete a tenant (cascade). */
export async function DELETE(
  _req: Request,
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
  await db.restaurant.delete({ where: { id } })

  await db.auditLog.create({
    data: {
      userId: (session.user as any).id,
      action: 'DELETE',
      entity: 'RESTAURANT',
      entityId: id,
    },
  })

  return NextResponse.json({ success: true })
}
