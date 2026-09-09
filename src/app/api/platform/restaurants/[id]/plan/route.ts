import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/tenant'
import { changePlanSchema, platformUpdateTenantSchema } from '@/lib/validations'
import { getPlan } from '@/lib/plans'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/** Change a tenant's subscription plan. */
export async function POST(
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
    const parsed = changePlanSchema.parse(body)
    const plan = getPlan(parsed.plan)

    const existing = await db.restaurant.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const amount =
      (parsed.billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice) * 100

    const periodEnd = new Date()
    periodEnd.setDate(periodEnd.getDate() + (parsed.billingCycle === 'YEARLY' ? 365 : 30))

    // Update restaurant
    await db.restaurant.update({
      where: { id },
      data: {
        plan: parsed.plan,
        subscriptionStatus: parsed.plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
      },
    })

    // Upsert subscription
    const sub = await db.subscription.findUnique({ where: { restaurantId: id } })
    if (sub) {
      await db.subscription.update({
        where: { restaurantId: id },
        data: {
          plan: parsed.plan,
          billingCycle: parsed.billingCycle,
          amount,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          status: parsed.plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
        },
      })
    } else {
      await db.subscription.create({
        data: {
          restaurantId: id,
          plan: parsed.plan,
          billingCycle: parsed.billingCycle,
          amount,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          status: parsed.plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
        },
      })
    }

    await db.auditLog.create({
      data: {
        restaurantId: id,
        userId: (session.user as any).id,
        action: 'UPDATE',
        entity: 'SUBSCRIPTION',
        entityId: id,
        details: JSON.stringify({
          action: 'PLAN_CHANGE',
          from: existing.plan,
          to: parsed.plan,
          billingCycle: parsed.billingCycle,
        }),
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    }
    console.error('[platform/restaurants/:id/plan] error:', err)
    return NextResponse.json({ error: 'Failed to change plan' }, { status: 500 })
  }
}

/** Get current plan & usage for a tenant. */
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
      _count: {
        select: { tables: true, menuItems: true, users: true, branches: true, menuCategories: true },
      },
    },
  })
  if (!restaurant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = getPlan(restaurant.plan)
  return NextResponse.json({
    success: true,
    data: {
      plan: plan.id,
      planName: plan.name,
      subscription: restaurant.subscription,
      usage: {
        tables: { current: restaurant._count.tables, limit: plan.limits.maxTables },
        menuItems: { current: restaurant._count.menuItems, limit: plan.limits.maxMenuItems },
        staff: { current: restaurant._count.users, limit: plan.limits.maxStaff },
        branches: { current: restaurant._count.branches, limit: plan.limits.maxBranches },
        categories: { current: restaurant._count.menuCategories, limit: plan.limits.maxCategories },
      },
    },
  })
}
