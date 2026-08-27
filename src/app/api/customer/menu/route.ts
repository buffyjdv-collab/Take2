import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// GET /api/customer/menu?table=<token>
// Public — no auth (table token provides tenant scoping)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('table')
  if (!token) return fail('Missing table token.', 400)

  const table = await db.table.findUnique({
    where: { qrCodeToken: token },
    include: { restaurant: { include: { settings: true } } },
  })
  if (!table) return fail('Invalid or unknown QR code.', 404)
  if (!table.active) return fail('This table is currently inactive.', 410)

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

  const [categories, items, modifierGroups, paymentMethods] = await Promise.all([
    db.menuCategory.findMany({
      where: { restaurantId: restaurant.id, active: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.menuItem.findMany({
      where: { restaurantId: restaurant.id },
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
