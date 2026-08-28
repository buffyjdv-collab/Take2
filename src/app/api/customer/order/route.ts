import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  fail,
  ok,
  generateOrderNumber,
  restaurantPrefix,
} from '@/lib/api-helpers'
import { createOrderSchema } from '@/lib/validations'
import { publishRealtime } from '@/lib/realtime-server'
import { getPlatformFeeConfig, calculateOrderFee } from '@/lib/platform-fee'

export const dynamic = 'force-dynamic'

// POST /api/customer/order
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body.', 400)
  }

  const parsed = createOrderSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      422,
    )
  }
  const input = parsed.data

  // 1. Idempotency — return existing order if same key was used
  const existing = await db.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { items: { include: { modifiers: true } }, table: true },
  })
  if (existing) {
    return ok(existing, 200)
  }

  // 2. Lookup table
  const table = await db.table.findUnique({
    where: { qrCodeToken: input.tableToken },
    include: { restaurant: { include: { settings: true } } },
  })
  if (!table) return fail('Invalid or unknown QR code.', 404)
  if (!table.active) return fail('This table is currently inactive.', 410)

  const restaurant = table.restaurant
  if (!restaurant) return fail('Restaurant not found.', 404)
  if (!restaurant.isOpen) return fail('Restaurant is currently closed.', 423)

  // Block order placement if the restaurant has overdue platform fees.
  if (restaurant.platformFeeBlocked) {
    return fail(
      'This restaurant is temporarily unavailable for orders. Please contact the restaurant directly.',
      410,
    )
  }

  // 3. Server-side price calculation. NEVER trust client prices.
  //    Resolve each menu item + variant + modifiers from DB.
  const menuItemIds = Array.from(
    new Set(input.items.map((i) => i.menuItemId)),
  )
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: menuItemIds } },
    include: {
      variants: true,
      modifierGroups: { include: { modifiers: true } },
    },
  })
  const menuItemMap = new Map(menuItems.map((m) => [m.id, m]))

  // Verify all items belong to this restaurant
  for (const it of input.items) {
    const m = menuItemMap.get(it.menuItemId)
    if (!m || m.restaurantId !== restaurant.id) {
      return fail(`Item not found: ${it.menuItemId}`, 404)
    }
    if (m.soldOut || !m.available) {
      return fail(`Item unavailable: ${m.name}`, 409)
    }
  }

  // Compute line items
  const lineItems: Array<{
    menuItemId: string
    menuItemName: string
    menuItemImage: string | null
    variantId: string | null
    variantName: string | null
    quantity: number
    basePrice: number
    variantPrice: number
    modifiersTotal: number
    unitPrice: number
    totalPrice: number
    isVeg: boolean
    notes: string | null
    modifiers: Array<{
      modifierId: string
      modifierName: string
      groupName: string
      price: number
    }>
  }> = []

  for (const it of input.items) {
    const m = menuItemMap.get(it.menuItemId)!
    const variant = it.variantId
      ? m.variants.find((v) => v.id === it.variantId)
      : m.variants.find((v) => v.isDefault) || m.variants[0]
    if (it.variantId && !variant) {
      return fail(`Invalid variant for item: ${m.name}`, 422)
    }

    // Resolve modifier objects (search both item-level and restaurant-wide groups)
    const allModifierIds = it.modifierIds || []
    const modObjects: Array<{
      id: string
      name: string
      price: number
      groupName: string
    }> = []
    if (allModifierIds.length > 0) {
      // Fetch from DB to be safe (rather than trusting in-memory groups)
      const mods = await db.modifier.findMany({
        where: { id: { in: allModifierIds } },
        include: { group: true },
      })
      for (const mod of mods) {
        if (mod.group.restaurantId !== restaurant.id) {
          return fail(`Invalid modifier: ${mod.name}`, 422)
        }
        modObjects.push({
          id: mod.id,
          name: mod.name,
          price: mod.price,
          groupName: mod.group.name,
        })
      }
    }

    const basePrice = m.basePrice
    const variantPrice = variant?.priceModifier || 0
    const modifiersTotal = modObjects.reduce((sum, x) => sum + x.price, 0)
    const unitPrice = basePrice + variantPrice + modifiersTotal
    const totalPrice = unitPrice * it.quantity

    lineItems.push({
      menuItemId: m.id,
      menuItemName: m.name,
      menuItemImage: m.image,
      variantId: variant?.id || null,
      variantName: variant?.name || null,
      quantity: it.quantity,
      basePrice,
      variantPrice,
      modifiersTotal,
      unitPrice,
      totalPrice,
      isVeg: m.isVeg,
      notes: it.notes || null,
      modifiers: modObjects.map((x) => ({
        modifierId: x.id,
        modifierName: x.name,
        groupName: x.groupName,
        price: x.price,
      })),
    })
  }

  // Totals
  const subtotal = lineItems.reduce((s, i) => s + i.totalPrice, 0)
  const taxAmount = +(subtotal * restaurant.taxRate).toFixed(2)
  const serviceCharge = +(subtotal * restaurant.serviceChargeRate).toFixed(2)
  const discountAmount = 0
  const grandTotal = +(
    subtotal +
    taxAmount +
    serviceCharge -
    discountAmount
  ).toFixed(2)
  const netTotal = grandTotal // no refund yet

  // Calculate platform fee
  const feeConfig = await getPlatformFeeConfig()
  const fee = calculateOrderFee(
    { subtotal, discountAmount, taxAmount, serviceCharge, grandTotal },
    feeConfig,
  )

  // Order number — increment from current count for restaurant
  const orderCount = await db.order.count({
    where: { restaurantId: restaurant.id },
  })
  const prefix = restaurantPrefix(restaurant.name)
  const orderNumber = generateOrderNumber(prefix, orderCount)

  // Optional customer
  let customerId: string | null = null
  // customerInfo is guaranteed by createOrderSchema (name + phone are required),
  // but be defensive in case an older client submits without them.
  const customerName = input.customerInfo?.name?.trim() || null
  const customerPhone = input.customerInfo?.phone?.trim() || null
  const customerEmail = input.customerInfo?.email?.trim() || null
  if (customerPhone || customerEmail) {
    const existing = customerPhone
      ? await db.customer.findFirst({
          where: {
            restaurantId: restaurant.id,
            phone: customerPhone,
          },
        })
      : null
    if (existing) {
      customerId = existing.id
      await db.customer.update({
        where: { id: existing.id },
        data: {
          name: customerName || existing.name,
          email: customerEmail || existing.email,
        },
      })
    } else {
      const c = await db.customer.create({
        data: {
          restaurantId: restaurant.id,
          name: customerName,
          phone: customerPhone,
          email: customerEmail || null,
        },
      })
      customerId = c.id
    }
  }

  // Decide the initial status for the new order.
  // The old auto-pre-payment-timing logic was removed — every new order now
  // starts as 'NEW'. Staff can still manually request payment at any point
  // via /api/admin/orders/[id]/request-payment (which sets the
  // `prePaymentRequested` / `postPaymentRequested` flags the customer UI
  // reads to show a "Please pay" prompt).
  const initialStatus = 'NEW'

  // Resolve the chosen payment-method row (if any) so we can snapshot both
  // its ID and its `type` onto the order. The type is used by legacy code that
  // reads `order.paymentMethod`; the ID is used by the post-serve payment
  // picker to hide the same pay-on-delivery method the customer already chose.
  let chosenPaymentMethod: { id: string; type: string } | null = null
  if (input.paymentMethodId) {
    const pm = await db.restaurantPaymentMethod.findUnique({
      where: { id: input.paymentMethodId },
      select: { id: true, type: true, restaurantId: true, active: true },
    })
    // Security: the method must belong to THIS restaurant and be active.
    if (pm && pm.restaurantId === restaurant.id && pm.active) {
      chosenPaymentMethod = { id: pm.id, type: pm.type }
    }
  }

  // Create order + items + modifiers + update table — in a transaction
  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        restaurantId: restaurant.id,
        branchId: table.branchId,
        tableId: table.id,
        customerId,
        // Snapshot customer name & phone on the order so the restaurant always
        // has them even if the Customer record is later deleted.
        customerName,
        customerPhone,
        status: initialStatus,
        paymentStatus: 'PENDING',
        paymentMethod: chosenPaymentMethod?.type || null,
        paymentMethodId: chosenPaymentMethod?.id || null,
        notes: input.notes || null,
        idempotencyKey: input.idempotencyKey,
        // Pre/post payment flags are set ONLY when staff manually requests
        // payment via /api/admin/orders/[id]/request-payment.
        prePaymentRequested: false,
        prePaymentRequestedAt: null,
        subtotal,
        taxAmount,
        serviceCharge,
        discountAmount,
        grandTotal,
        netTotal,
        platformFeeAmount: fee.feeAmount,
        platformFeeBase: fee.baseAmount,
        platformFeePayer: fee.skipped ? null : fee.payer,
        placedAt: new Date(),
        acceptedById: null,
        servedById: null,
        items: {
          create: lineItems.map((li) => ({
            menuItemId: li.menuItemId,
            menuItemName: li.menuItemName,
            menuItemImage: li.menuItemImage,
            variantId: li.variantId,
            variantName: li.variantName,
            quantity: li.quantity,
            basePrice: li.basePrice,
            variantPrice: li.variantPrice,
            modifiersTotal: li.modifiersTotal,
            unitPrice: li.unitPrice,
            totalPrice: li.totalPrice,
            isVeg: li.isVeg,
            notes: li.notes,
            modifiers: {
              create: li.modifiers.map((mod) => ({
                modifierId: mod.modifierId,
                modifierName: mod.modifierName,
                groupName: mod.groupName,
                price: mod.price,
              })),
            },
          })),
        },
      },
      include: {
        items: { include: { modifiers: true } },
        table: true,
      },
    })

    // Update table status to ORDERING (if currently AVAILABLE)
    if (table.status === 'AVAILABLE') {
      await tx.table.update({
        where: { id: table.id },
        data: { status: 'ORDERING' },
      })
    }

    // Create platform fee record (skip for monthly subscription)
    if (!fee.skipped && fee.feeAmount > 0) {
      await tx.platformFee.create({
        data: {
          orderId: order.id,
          restaurantId: restaurant.id,
          feeType: fee.feeType,
          percentageRate: fee.percentageRate,
          fixedAmount: fee.fixedAmount,
          baseAmount: fee.baseAmount,
          grossFee: fee.grossFee,
          feeAmount: fee.feeAmount,
          payer: fee.payer,
          customerPortion: fee.customerPortion,
          restaurantPortion: fee.restaurantPortion,
          status: 'PENDING',
        },
      })
    }

    // Auto-accept if configured (no longer gated by pre-payment — orders always
    // start as 'NEW' now, so this transitions them straight to ACCEPTED when
    // the restaurant has auto-accept turned on in Settings)
    if (restaurant.settings?.autoAcceptOrders) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      })
    }

    // Notification row for kitchen
    if (restaurant.settings?.notifyKitchenOnNewOrder !== false) {
      await tx.notification.create({
        data: {
          restaurantId: restaurant.id,
          target: 'KITCHEN',
          type: 'NEW_ORDER',
          title: `New order ${order.orderNumber}`,
          message: `Table ${table.number} • ${lineItems.length} item(s) • ₹${grandTotal.toFixed(0)}`,
          orderId: order.id,
          tableId: table.id,
        },
      })
    }

    return order
  })

  // Emit realtime event — best effort
  publishRealtime('order:new', {
    restaurantId: restaurant.id,
    payload: {
      orderId: created.id,
      orderNumber: created.orderNumber,
      tableId: table.id,
      tableNumber: table.number,
      status: created.status,
      paymentStatus: created.paymentStatus,
      grandTotal: created.grandTotal,
      placedAt: created.placedAt,
      itemCount: created.items.length,
    },
  })

  return ok(created, 201)
}
