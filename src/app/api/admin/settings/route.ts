import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
} from '@/lib/api-helpers'
import { settingsSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET /api/admin/settings
export async function GET(req: NextRequest) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  if (!restaurantId) {
    return fail('No restaurant scope available. Super admins must pass ?restaurantId=.', 400)
  }

  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    include: { settings: true, branches: true },
  })
  if (!restaurant) return fail('Restaurant not found.', 404)
  return ok(restaurant)
}

// PATCH /api/admin/settings
export async function PATCH(req: NextRequest) {
  const { user, error } = await requirePermission('settings.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  let restaurantId = user.restaurantId
  if (user.role === 'SUPER_ADMIN') {
    restaurantId = req.nextUrl.searchParams.get('restaurantId') || restaurantId || null
  }
  if (!restaurantId) {
    return fail('No restaurant to update.', 400)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid input.', 422)
  }
  const data = parsed.data
  const { settings: settingsPatch, ...restFields } = data

  const updated = await db.$transaction(async (tx) => {
    const r = await tx.restaurant.update({
      where: { id: restaurantId as string },
      data: {
        ...(restFields.name !== undefined ? { name: restFields.name } : {}),
        ...(restFields.tagline !== undefined ? { tagline: restFields.tagline || null } : {}),
        ...(restFields.description !== undefined
          ? { description: restFields.description || null }
          : {}),
        ...(restFields.address !== undefined ? { address: restFields.address } : {}),
        ...(restFields.phone !== undefined ? { phone: restFields.phone } : {}),
        ...(restFields.email !== undefined ? { email: restFields.email || null } : {}),
        ...(restFields.website !== undefined ? { website: restFields.website || null } : {}),
        ...(restFields.logo !== undefined ? { logo: restFields.logo || null } : {}),
        ...(restFields.gstNumber !== undefined ? { gstNumber: restFields.gstNumber || null } : {}),
        ...(restFields.panNumber !== undefined ? { panNumber: restFields.panNumber || null } : {}),
        ...(restFields.taxRate !== undefined ? { taxRate: restFields.taxRate } : {}),
        ...(restFields.serviceChargeRate !== undefined
          ? { serviceChargeRate: restFields.serviceChargeRate }
          : {}),
        ...(restFields.openingTime !== undefined ? { openingTime: restFields.openingTime } : {}),
        ...(restFields.closingTime !== undefined ? { closingTime: restFields.closingTime } : {}),
        ...(restFields.isOpen !== undefined ? { isOpen: restFields.isOpen } : {}),
        ...(restFields.acceptUpi !== undefined ? { acceptUpi: restFields.acceptUpi } : {}),
        ...(restFields.acceptCard !== undefined ? { acceptCard: restFields.acceptCard } : {}),
        ...(restFields.acceptCash !== undefined ? { acceptCash: restFields.acceptCash } : {}),
        ...(restFields.acceptCounter !== undefined ? { acceptCounter: restFields.acceptCounter } : {}),
        ...(restFields.primaryColor !== undefined ? { primaryColor: restFields.primaryColor } : {}),
        ...(restFields.accentColor !== undefined ? { accentColor: restFields.accentColor } : {}),
        ...(restFields.upiId !== undefined ? { upiId: restFields.upiId || null } : {}),
      },
    })

    if (settingsPatch) {
      const existing = await tx.restaurantSettings.findUnique({
        where: { restaurantId: r.id },
      })
      if (existing) {
        await tx.restaurantSettings.update({
          where: { restaurantId: r.id },
          data: {
            ...(settingsPatch.receiptHeader !== undefined
              ? { receiptHeader: settingsPatch.receiptHeader || null }
              : {}),
            ...(settingsPatch.receiptFooter !== undefined
              ? { receiptFooter: settingsPatch.receiptFooter || null }
              : {}),
            ...(settingsPatch.showLogoOnReceipt !== undefined
              ? { showLogoOnReceipt: settingsPatch.showLogoOnReceipt }
              : {}),
            ...(settingsPatch.notifyKitchenOnNewOrder !== undefined
              ? { notifyKitchenOnNewOrder: settingsPatch.notifyKitchenOnNewOrder }
              : {}),
            ...(settingsPatch.notifyWaiterOnBillRequest !== undefined
              ? { notifyWaiterOnBillRequest: settingsPatch.notifyWaiterOnBillRequest }
              : {}),
            ...(settingsPatch.playSoundOnNewOrder !== undefined
              ? { playSoundOnNewOrder: settingsPatch.playSoundOnNewOrder }
              : {}),
            ...(settingsPatch.autoAcceptOrders !== undefined
              ? { autoAcceptOrders: settingsPatch.autoAcceptOrders }
              : {}),
            ...(settingsPatch.allowCallWaiter !== undefined
              ? { allowCallWaiter: settingsPatch.allowCallWaiter }
              : {}),
            ...(settingsPatch.allowRequestBill !== undefined
              ? { allowRequestBill: settingsPatch.allowRequestBill }
              : {}),
            ...(settingsPatch.maxItemsPerOrder !== undefined
              ? { maxItemsPerOrder: settingsPatch.maxItemsPerOrder }
              : {}),
            ...(settingsPatch.taxInclusive !== undefined
              ? { taxInclusive: settingsPatch.taxInclusive }
              : {}),
          },
        })
      } else {
        await tx.restaurantSettings.create({
          data: {
            restaurantId: r.id,
            receiptHeader: settingsPatch.receiptHeader || null,
            receiptFooter: settingsPatch.receiptFooter || null,
            showLogoOnReceipt: settingsPatch.showLogoOnReceipt ?? true,
            notifyKitchenOnNewOrder: settingsPatch.notifyKitchenOnNewOrder ?? true,
            notifyWaiterOnBillRequest: settingsPatch.notifyWaiterOnBillRequest ?? true,
            playSoundOnNewOrder: settingsPatch.playSoundOnNewOrder ?? true,
            autoAcceptOrders: settingsPatch.autoAcceptOrders ?? false,
            allowCallWaiter: settingsPatch.allowCallWaiter ?? true,
            allowRequestBill: settingsPatch.allowRequestBill ?? true,
            maxItemsPerOrder: settingsPatch.maxItemsPerOrder ?? 50,
            taxInclusive: settingsPatch.taxInclusive ?? false,
          },
        })
      }
    }

    return tx.restaurant.findUnique({
      where: { id: r.id },
      include: { settings: true },
    })
  })

  writeAudit(user, 'UPDATE', 'RESTAURANT', restaurantId, data)
  return ok(updated)
}
