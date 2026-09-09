import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { signupSchema } from '@/lib/validations'
import { getPlan } from '@/lib/plans'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/**
 * Public restaurant signup endpoint.
 * Creates a new tenant (Restaurant + Branch + Owner User + Subscription) atomically.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = signupSchema.parse(body)

    // 1. Check for existing restaurant slug
    const existingSlug = await db.restaurant.findUnique({
      where: { slug: parsed.slug },
    })
    if (existingSlug) {
      return NextResponse.json(
        { success: false, error: 'This URL slug is already taken. Please choose another.' },
        { status: 409 },
      )
    }

    // 2. Check for existing owner email
    const existingUser = await db.user.findUnique({
      where: { email: parsed.ownerEmail.toLowerCase() },
    })
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists. Please sign in instead.' },
        { status: 409 },
      )
    }

    // 3. Verify plan exists
    const plan = getPlan(parsed.plan)

    // 4. Hash password
    const passwordHash = await bcrypt.hash(parsed.ownerPassword, 10)

    // 5. Create everything in a transaction
    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 14)

    const result = await db.$transaction(async (tx) => {
      // Restaurant
      const restaurant = await tx.restaurant.create({
        data: {
          slug: parsed.slug,
          name: parsed.restaurantName,
          tagline: parsed.tagline,
          address: parsed.address,
          city: parsed.city,
          phone: parsed.phone,
          email: parsed.email,
          plan: parsed.plan,
          subscriptionStatus: parsed.plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
          trialEndsAt: parsed.plan === 'TRIAL' ? trialEndsAt : null,
        },
      })

      // Default branch
      const branch = await tx.branch.create({
        data: {
          restaurantId: restaurant.id,
          name: 'Main Branch',
          address: parsed.address,
          phone: parsed.phone,
          active: true,
        },
      })

      // Owner user
      const owner = await tx.user.create({
        data: {
          email: parsed.ownerEmail.toLowerCase(),
          name: parsed.ownerName,
          passwordHash,
          role: 'RESTAURANT_OWNER',
          restaurantId: restaurant.id,
          branchId: branch.id,
          active: true,
        },
      })

      // Restaurant settings (defaults)
      await tx.restaurantSettings.create({
        data: { restaurantId: restaurant.id },
      })

      // Subscription
      const subStatus = parsed.plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE'
      await tx.subscription.create({
        data: {
          restaurantId: restaurant.id,
          plan: parsed.plan,
          status: subStatus,
          billingCycle: parsed.billingCycle,
          amount:
            parsed.billingCycle === 'YEARLY'
              ? plan.yearlyPrice * 100
              : plan.monthlyPrice * 100,
          currency: 'INR',
          trialStartsAt: parsed.plan === 'TRIAL' ? new Date() : null,
          trialEndsAt: parsed.plan === 'TRIAL' ? trialEndsAt : null,
          currentPeriodStart: parsed.plan === 'TRIAL' ? null : new Date(),
          currentPeriodEnd: parsed.plan === 'TRIAL'
            ? null
            : new Date(Date.now() + (parsed.billingCycle === 'YEARLY' ? 365 : 30) * 24 * 60 * 60 * 1000),
          autoRenew: parsed.plan !== 'TRIAL',
        },
      })

      // First default table (T1) so they can start scanning immediately
      const token = `${parsed.slug.slice(0, 6)}-1-${Math.random().toString(36).slice(2, 12)}`
      await tx.table.create({
        data: {
          restaurantId: restaurant.id,
          branchId: branch.id,
          number: 'T1',
          label: 'Table 1',
          capacity: 4,
          active: true,
          qrCodeToken: token,
          status: 'AVAILABLE',
        },
      })

      // Seed a few default categories so the menu isn't empty
      const defaultCategories = [
        { name: 'Starters', icon: '🥗', sortOrder: 1 },
        { name: 'Main Course', icon: '🍛', sortOrder: 2 },
        { name: 'Beverages', icon: '🥤', sortOrder: 3 },
      ]
      for (const c of defaultCategories) {
        await tx.menuCategory.create({
          data: { restaurantId: restaurant.id, ...c, active: true },
        })
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          restaurantId: restaurant.id,
          userId: owner.id,
          action: 'CREATE',
          entity: 'RESTAURANT',
          entityId: restaurant.id,
          details: JSON.stringify({
            source: 'SELF_SIGNUP',
            plan: parsed.plan,
            slug: parsed.slug,
          }),
        },
      })

      return { restaurant, owner, branch }
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          restaurantId: result.restaurant.id,
          slug: result.restaurant.slug,
          restaurantName: result.restaurant.name,
          ownerId: result.owner.id,
          ownerEmail: result.owner.email,
          plan: parsed.plan,
          trialEndsAt: parsed.plan === 'TRIAL' ? trialEndsAt : null,
        },
      },
      { status: 201 },
    )
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      const issues = err.issues || []
      return NextResponse.json(
        { success: false, error: issues[0]?.message || 'Invalid input' },
        { status: 400 },
      )
    }
    console.error('[signup] error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to create restaurant. Please try again.' },
      { status: 500 },
    )
  }
}
