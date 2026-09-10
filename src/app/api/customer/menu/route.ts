import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'
import { tableTokenVariants } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

// GET /api/customer/menu?table=<token>
// Public — no auth (table token provides tenant scoping)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('table')
  if (!token) return fail('Missing table token.', 400)

  // Some phone cameras re-encode scanned URLs (space → +, %20 → %2520), so a
  // few token spellings are tried before giving up — keeps legacy printed
  // QRs scannable while repaired (URL-safe) tokens become the norm.
  type TableWithRestaurant = Prisma.TableGetPayload<{
    include: { restaurant: { include: { settings: true } } }
  }>
  let table: TableWithRestaurant | null = null
  for (const candidate of tableTokenVariants(token)) {
    table = await db.table.findUnique({
      where: { qrCodeToken: candidate },
      include: { restaurant: { include: { settings: true } } },
    })
    if (table) break
  }
  if (!table) return fail('Invalid or unknown QR code.', 404)
  if (!table.active) return fail('This table is currently inactive.', 410)
  // Owner-approval workflow: tables created by a branch manager only go live
  // once the restaurant owner approves them.
  if (table.approvalStatus !== 'APPROVED') {
    return fail('This table is not open for orders yet. Please contact the staff.', 410)
  }

  const restaurant = table.restaurant
  if (!restaurant) return fail('Restaurant not found.', 404)

  // Block QR menu access if the restaurant has overdue platform fees.
  // The super admin can toggle this from the Platform Fees page.
  if (restaurant.platformFeeBlocked) {
    return fail(
      'This restaurant is temporarily unavailable. Please contact the restaurant directly.',
      410,
    )
  }

  // STRICT branch-scoped menus: each branch's QR menu shows ONLY that
  // branch's own categories/items. Restaurant-wide (branchId = null) content
  // is the main menu and appears exclusively on tables that do not belong to
  // any branch — branch menus never leak into other branches or the main
  // branch, and the main menu never leaks into branch tables.
  const menuScope = table.branchId
    ? { branchId: table.branchId }
    : { branchId: null }

  const [categories, items, modifierGroups, paymentMethods] = await Promise.all([
    db.menuCategory.findMany({
      where: {
        restaurantId: restaurant.id,
        active: true,
        approvalStatus: 'APPROVED',
        ...menuScope,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    db.menuItem.findMany({
      where: {
        restaurantId: restaurant.id,
        approvalStatus: 'APPROVED',
        ...menuScope,
        // The item's category must live in the SAME scope — otherwise an
        // item filed under another branch's category would be orphaned.
        category: {
          approvalStatus: 'APPROVED',
          ...menuScope,
        },
      },
      include: {
        category: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        modifierGroups: {
          include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    db.modifierGroup.findMany({
      where: {
        restaurantId: restaurant.id,
        menuItemId: null,
      },
      include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    }),
    db.restaurantPaymentMethod
      .findMany({
        where: { restaurantId: restaurant.id, active: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      })
      .catch(() => []),
  ])

  return ok({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      logo: restaurant.logo,
      tagline: restaurant.tagline,
      description: restaurant.description,
      address: restaurant.address,
      phone: restaurant.phone,
      email: restaurant.email,
      gstNumber: restaurant.gstNumber,
      panNumber: restaurant.panNumber,
      isOpen: restaurant.isOpen,
      openingTime: restaurant.openingTime,
      closingTime: restaurant.closingTime,
      currencySymbol: restaurant.currencySymbol,
      primaryColor: restaurant.primaryColor,
      accentColor: restaurant.accentColor,
      taxRate: restaurant.taxRate,
      serviceChargeRate: restaurant.serviceChargeRate,
      acceptUpi: restaurant.acceptUpi,
      acceptCard: restaurant.acceptCard,
      acceptCash: restaurant.acceptCash,
      acceptCounter: restaurant.acceptCounter,
      upiId: restaurant.upiId,
      settings: restaurant.settings,
      paymentMethods: paymentMethods.map((m) => ({
        id: m.id,
        type: m.type,
        label: m.label,
        description: m.description,
        icon: m.icon,
        accentColor: m.accentColor,
        priority: m.priority,
        config: m.config,
      })),
    },
    table: {
      id: table.id,
      number: table.number,
      label: table.label,
      capacity: table.capacity,
      status: table.status,
    },
    categories,
    items,
    restaurantWideModifierGroups: modifierGroups,
  })
}
