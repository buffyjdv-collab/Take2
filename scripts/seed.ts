/* eslint-disable */
/**
 * Seed script for Spice Garden restaurant demo data.
 * Run with: `bun run scripts/seed.ts` (or `npx tsx scripts/seed.ts`)
 *
 * Creates:
 *   - 1 Super Admin + 1 Owner + 1 Manager + 2 Kitchen + 3 Waiters + 1 Cashier
 *   - 1 Restaurant (Spice Garden) with 1 Branch
 *   - 20 Tables (T1..T20) with QR tokens
 *   - 6 Menu Categories
 *   - 24 Menu Items with variants + modifier groups
 *   - Restaurant Settings
 */
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db'
import { defaultSeededPaymentMethods } from '../src/lib/payment-method-defaults'

async function main() {
  console.log('🌱 Seeding Spice Garden restaurant...')

  // Clean existing data (order matters for FK constraints)
  await db.auditLog.deleteMany()
  await db.notification.deleteMany()
  await db.serviceRequest.deleteMany()
  await db.invoice.deleteMany()
  await db.payment.deleteMany()
  await db.orderItemModifier.deleteMany()
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.customer.deleteMany()
  await db.modifier.deleteMany()
  await db.modifierGroup.deleteMany()
  await db.menuVariant.deleteMany()
  await db.menuItem.deleteMany()
  await db.menuCategory.deleteMany()
  await db.table.deleteMany()
  await db.restaurantSettings.deleteMany()
  await db.restaurantPaymentMethod.deleteMany()
  await db.branch.deleteMany()
  await db.session.deleteMany()
  await db.account.deleteMany()
  await db.user.deleteMany()
  await db.restaurant.deleteMany()
  console.log('  ✓ Cleaned existing data')

  // ---------------------------------------------------------------- Restaurant
  const restaurant = await db.restaurant.create({
    data: {
      slug: 'spice-garden',
      name: 'Spice Garden',
      tagline: 'Authentic Indian Cuisine • Since 1998',
      description:
        'A beloved culinary destination serving authentic Indian flavors crafted from age-old family recipes. From sizzling tandoori starters to aromatic biryanis and rich curries, every dish is a celebration of India\'s diverse culinary heritage.',
      address: '14 MG Road, Bengaluru',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      phone: '+91 80 2345 6789',
      email: 'hello@spicegarden.in',
      website: 'spicegarden.in',
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      currency: 'INR',
      currencySymbol: '₹',
      taxRate: 0.05,
      serviceChargeRate: 0.0,
      openingTime: '09:00',
      closingTime: '23:00',
      isOpen: true,
      acceptUpi: true,
      acceptCard: true,
      acceptCash: true,
      acceptCounter: true,
      primaryColor: '#EA580C',
      accentColor: '#16A34A',
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
    },
  })
  console.log('  ✓ Created restaurant: Spice Garden')

  const branch = await db.branch.create({
    data: {
      restaurantId: restaurant.id,
      name: 'MG Road (Main)',
      address: '14 MG Road, Bengaluru',
      phone: '+91 80 2345 6789',
      active: true,
    },
  })

  await db.restaurantSettings.create({
    data: {
      restaurantId: restaurant.id,
      receiptHeader: 'Spice Garden — Thank you for dining with us!',
      receiptFooter: 'Visit again: spicegarden.in • +91 80 2345 6789',
      showLogoOnReceipt: true,
      notifyKitchenOnNewOrder: true,
      notifyWaiterOnBillRequest: true,
      playSoundOnNewOrder: true,
      autoAcceptOrders: false,
      allowCallWaiter: true,
      allowRequestBill: true,
      maxItemsPerOrder: 50,
      taxInclusive: false,
    },
  })

  // ---------------------------------------------------- Restaurant Payment Methods
  // Zepto-style: each row = one configurable payment option at checkout.
  // Defaults: UPI (active, with VPA), Cash (active), Counter (active),
  // Card / Wallet / Net Banking (seeded but inactive — flip on in Settings).
  await db.restaurantPaymentMethod.createMany({
    data: defaultSeededPaymentMethods(restaurant.upiId).map((m) => ({
      restaurantId: restaurant.id,
      type: m.type,
      label: m.label,
      description: m.description,
      icon: m.icon,
      accentColor: m.accentColor,
      active: m.active,
      priority: m.priority,
      config: m.config as any,
    })),
  })
  console.log('  ✓ Created 6 payment methods (3 active: UPI, Cash, Counter)')

  // -------------------------------------------------------------------- Users
  const passwordHash = await bcrypt.hash('password123', 10)

  const superAdmin = await db.user.create({
    data: {
      email: 'admin@platform.com',
      name: 'Platform Super Admin',
      passwordHash,
      role: 'SUPER_ADMIN',
      active: true,
    },
  })

  const owner = await db.user.create({
    data: {
      email: 'owner@spicegarden.in',
      name: 'Rajesh Kapoor',
      passwordHash,
      role: 'RESTAURANT_OWNER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const manager = await db.user.create({
    data: {
      email: 'manager@spicegarden.in',
      name: 'Priya Sharma',
      passwordHash,
      role: 'MANAGER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const kitchen1 = await db.user.create({
    data: {
      email: 'chef1@spicegarden.in',
      name: 'Chef Anil Kumar',
      passwordHash,
      role: 'KITCHEN_STAFF',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const kitchen2 = await db.user.create({
    data: {
      email: 'chef2@spicegarden.in',
      name: 'Chef Vikram Singh',
      passwordHash,
      role: 'KITCHEN_STAFF',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const waiter1 = await db.user.create({
    data: {
      email: 'waiter1@spicegarden.in',
      name: 'Suresh Patel',
      passwordHash,
      role: 'WAITER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const waiter2 = await db.user.create({
    data: {
      email: 'waiter2@spicegarden.in',
      name: 'Lakshmi Reddy',
      passwordHash,
      role: 'WAITER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const waiter3 = await db.user.create({
    data: {
      email: 'waiter3@spicegarden.in',
      name: 'Arjun Nair',
      passwordHash,
      role: 'WAITER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  const cashier = await db.user.create({
    data: {
      email: 'cashier@spicegarden.in',
      name: 'Meera Iyer',
      passwordHash,
      role: 'CASHIER',
      restaurantId: restaurant.id,
      branchId: branch.id,
      active: true,
    },
  })

  console.log('  ✓ Created 9 staff users (super admin, owner, manager, 2 chefs, 3 waiters, cashier)')

  // ------------------------------------------------------------------- Tables
  // 20 tables with unique secure QR tokens
  for (let i = 1; i <= 20; i++) {
    const number = `T${i}`
    const token = `sg-${i}-${Math.random().toString(36).slice(2, 12)}`
    const capacity = i <= 10 ? 4 : i <= 15 ? 6 : 8
    await db.table.create({
      data: {
        restaurantId: restaurant.id,
        branchId: branch.id,
        number,
        label: i <= 10 ? `Indoor ${i}` : i <= 15 ? `Window ${i}` : `Family ${i}`,
        capacity,
        active: true,
        qrCodeToken: token,
        status: 'AVAILABLE',
      },
    })
  }
  console.log('  ✓ Created 20 tables (T1..T20) with unique QR tokens')

  // ------------------------------------------------------------ Menu Categories
  const categories = await Promise.all(
    [
      { name: 'Starters',    icon: '🥗', sortOrder: 1 },
      { name: 'Biryani',     icon: '🍚', sortOrder: 2 },
      { name: 'Main Course', icon: '🍛', sortOrder: 3 },
      { name: 'Breads',      icon: '🫓', sortOrder: 4 },
      { name: 'Beverages',   icon: '🥤', sortOrder: 5 },
      { name: 'Desserts',    icon: '🍮', sortOrder: 6 },
    ].map((c) =>
      db.menuCategory.create({
        data: { restaurantId: restaurant.id, ...c, active: true },
      }),
    ),
  )
  const [startersCat, biryaniCat, mainCourseCat, breadsCat, beveragesCat, dessertsCat] = categories
  console.log('  ✓ Created 6 menu categories')

  // ----------------------------------------------------------- Helper: Addons
  // Reusable modifier groups
  const cheeseGroup = await db.modifierGroup.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Extra Cheese',
      selectionType: 'SINGLE',
      required: false,
      minSelection: 0,
      maxSelection: 1,
      sortOrder: 1,
      modifiers: {
        create: [
          { name: 'No Extra', price: 0, sortOrder: 1, isDefault: true },
          { name: 'Single',   price: 30, sortOrder: 2 },
          { name: 'Double',   price: 60, sortOrder: 3 },
        ],
      },
    },
  })

  const spiceGroup = await db.modifierGroup.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Spice Level',
      selectionType: 'SINGLE',
      required: true,
      minSelection: 1,
      maxSelection: 1,
      sortOrder: 2,
      modifiers: {
        create: [
          { name: 'Mild',      price: 0, sortOrder: 1, isDefault: true },
          { name: 'Medium',    price: 0, sortOrder: 2 },
          { name: 'Spicy',     price: 0, sortOrder: 3 },
          { name: 'Extra Spicy', price: 0, sortOrder: 4 },
        ],
      },
    },
  })

  const addonGroup = await db.modifierGroup.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Add-ons',
      selectionType: 'MULTIPLE',
      required: false,
      minSelection: 0,
      maxSelection: 5,
      sortOrder: 3,
      modifiers: {
        create: [
          { name: 'Extra Patty', price: 80, sortOrder: 1 },
          { name: 'Fries',       price: 60, sortOrder: 2 },
          { name: 'Coleslaw',    price: 50, sortOrder: 3 },
          { name: 'Sauce Dip',   price: 25, sortOrder: 4 },
          { name: 'Onion Rings', price: 70, sortOrder: 5 },
        ],
      },
    },
  })

  const sauceGroup = await db.modifierGroup.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Sauce Choice',
      selectionType: 'SINGLE',
      required: true,
      minSelection: 1,
      maxSelection: 1,
      sortOrder: 4,
      modifiers: {
        create: [
          { name: 'Mint Mayo',  price: 0, sortOrder: 1, isDefault: true },
          { name: 'Tomato',     price: 0, sortOrder: 2 },
          { name: 'Cheese',     price: 10, sortOrder: 3 },
          { name: 'Peri Peri',  price: 15, sortOrder: 4 },
        ],
      },
    },
  })

  const sizeGroup = await db.modifierGroup.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Size',
      selectionType: 'SINGLE',
      required: true,
      minSelection: 1,
      maxSelection: 1,
      sortOrder: 0,
      modifiers: {
        create: [
          { name: 'Regular', price: 0,  sortOrder: 1, isDefault: true },
          { name: 'Medium',  price: 40, sortOrder: 2 },
          { name: 'Large',   price: 80, sortOrder: 3 },
        ],
      },
    },
  })

  // --------------------------------------------------------------- Menu Items
  type MenuItemSeed = {
    name: string
    description: string
    image: string
    isVeg: boolean
    isSpicy: boolean
    basePrice: number
    category: any
    isFeatured?: boolean
    isPopular?: boolean
    prepTime?: number
    tags?: string
    variants?: { name: string; priceModifier: number; isDefault?: boolean }[]
    modifierGroupIds?: string[]
  }

  const items: MenuItemSeed[] = [
    // ---- Starters ----
    {
      name: 'Paneer Tikka',
      description: 'Cubes of cottage cheese marinated in spiced yogurt and char-grilled in the tandoor with bell peppers and onions.',
      image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600',
      isVeg: true, isSpicy: false, basePrice: 249, category: startersCat, isFeatured: true, prepTime: 15,
      tags: 'bestseller, tandoor',
      variants: [
        { name: 'Half (6 pcs)', priceModifier: 0, isDefault: true },
        { name: 'Full (12 pcs)', priceModifier: 130 },
      ],
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Chicken 65',
      description: 'Deep-fried chicken bites tossed in a fiery South Indian style curry leaf and chili tempering.',
      image: 'https://images.unsplash.com/photo-1610057099431-d73a1c9d2f2f?w=600',
      isVeg: false, isSpicy: true, basePrice: 279, category: startersCat, isPopular: true, prepTime: 15,
      tags: 'spicy, south indian',
      variants: [
        { name: 'Half', priceModifier: 0, isDefault: true },
        { name: 'Full', priceModifier: 140 },
      ],
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Veg Manchurian',
      description: 'Crispy vegetable dumplings tossed in a tangy, garlicky Indo-Chinese sauce.',
      image: 'https://images.unsplash.com/photo-1626100134240-cba0adfb46e2?w=600',
      isVeg: true, isSpicy: false, basePrice: 219, category: startersCat, prepTime: 12,
      variants: [
        { name: 'Dry', priceModifier: 0, isDefault: true },
        { name: 'Gravy', priceModifier: 20 },
      ],
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Crispy Corn',
      description: 'Golden fried sweet corn kernels tossed with peppers, onions and a mild chili seasoning.',
      image: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=600',
      isVeg: true, isSpicy: false, basePrice: 199, category: startersCat, prepTime: 10,
      modifierGroupIds: [spiceGroup.id],
    },
    // ---- Biryani ----
    {
      name: 'Chicken Biryani',
      description: 'Long-grain basmati rice layered with marinated chicken, saffron, fried onions and aromatic spices. Dum-cooked to perfection. Served with raita and salan.',
      image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600',
      isVeg: false, isSpicy: true, basePrice: 299, category: biryaniCat, isFeatured: true, isPopular: true, prepTime: 25,
      tags: 'bestseller, dum-cooked',
      variants: [
        { name: 'Regular', priceModifier: 0, isDefault: true },
        { name: 'Large',   priceModifier: 80 },
      ],
      modifierGroupIds: [spiceGroup.id, addonGroup.id],
    },
    {
      name: 'Mutton Biryani',
      description: 'Tender slow-cooked mutton layered with fragrant basmati rice, saffron and whole spices.',
      image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600',
      isVeg: false, isSpicy: true, basePrice: 379, category: biryaniCat, isPopular: true, prepTime: 30,
      tags: 'premium',
      variants: [
        { name: 'Regular', priceModifier: 0, isDefault: true },
        { name: 'Large',   priceModifier: 90 },
      ],
      modifierGroupIds: [spiceGroup.id, addonGroup.id],
    },
    {
      name: 'Veg Dum Biryani',
      description: 'Basmati rice dum-cooked with mixed seasonal vegetables, saffron, mint and whole spices.',
      image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600',
      isVeg: true, isSpicy: true, basePrice: 249, category: biryaniCat, prepTime: 22,
      variants: [
        { name: 'Regular', priceModifier: 0, isDefault: true },
        { name: 'Large',   priceModifier: 70 },
      ],
      modifierGroupIds: [spiceGroup.id, addonGroup.id],
    },
    {
      name: 'Hyderabadi Veg Biryani',
      description: 'Authentic Hyderabadi-style biryani with vegetables, mint, fried onions and a hint of saffron.',
      image: 'https://images.unsplash.com/photo-1631452180791-6039c3b0fbf9?w=600',
      isVeg: true, isSpicy: true, basePrice: 269, category: biryaniCat, prepTime: 24,
      modifierGroupIds: [spiceGroup.id],
    },
    // ---- Main Course ----
    {
      name: 'Butter Chicken',
      description: 'Tandoor-roasted chicken simmered in a rich, creamy tomato and cashew gravy with a hint of fenugreek.',
      image: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600',
      isVeg: false, isSpicy: false, basePrice: 329, category: mainCourseCat, isFeatured: true, isPopular: true, prepTime: 20,
      tags: 'bestseller, creamy',
      variants: [
        { name: 'Half', priceModifier: 0, isDefault: true },
        { name: 'Full', priceModifier: 160 },
      ],
      modifierGroupIds: [spiceGroup.id, cheeseGroup.id],
    },
    {
      name: 'Paneer Butter Masala',
      description: 'Soft paneer cubes simmered in a creamy tomato gravy with cashews, butter and a touch of garam masala.',
      image: 'https://images.unsplash.com/photo-1631452180791-6039c3b0fbf9?w=600',
      isVeg: true, isSpicy: false, basePrice: 289, category: mainCourseCat, isPopular: true, prepTime: 18,
      tags: 'creamy, bestseller',
      variants: [
        { name: 'Half', priceModifier: 0, isDefault: true },
        { name: 'Full', priceModifier: 140 },
      ],
      modifierGroupIds: [spiceGroup.id, cheeseGroup.id],
    },
    {
      name: 'Dal Makhani',
      description: 'Black lentils slow-cooked overnight with butter, cream and tomatoes — a North Indian classic.',
      image: 'https://images.unsplash.com/photo-1626500153438-247f8c4ec008?w=600',
      isVeg: true, isSpicy: false, basePrice: 239, category: mainCourseCat, prepTime: 15,
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Kadai Paneer',
      description: 'Paneer and bell peppers tossed in a freshly ground kadai masala with onions and tomatoes.',
      image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=600',
      isVeg: true, isSpicy: true, basePrice: 279, category: mainCourseCat, prepTime: 18,
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Mutton Rogan Josh',
      description: 'Tender mutton pieces slow-cooked in a Kashmiri-style aromatic red gravy with whole spices.',
      image: 'https://images.unsplash.com/photo-1574484284002-952d92456975?w=600',
      isVeg: false, isSpicy: true, basePrice: 389, category: mainCourseCat, prepTime: 30,
      tags: 'premium',
      modifierGroupIds: [spiceGroup.id],
    },
    {
      name: 'Chicken Tikka Masala',
      description: 'Char-grilled chicken tikka simmered in a rich onion-tomato gravy with creamy texture and aromatic spices.',
      image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600',
      isVeg: false, isSpicy: false, basePrice: 319, category: mainCourseCat, prepTime: 20,
      modifierGroupIds: [spiceGroup.id, cheeseGroup.id],
    },
    // ---- Breads ----
    {
      name: 'Butter Naan',
      description: 'Soft leavened bread baked in the tandoor, brushed with butter.',
      image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600',
      isVeg: true, isSpicy: false, basePrice: 59, category: breadsCat, prepTime: 8,
    },
    {
      name: 'Garlic Naan',
      description: 'Naan topped with fresh garlic, coriander and butter.',
      image: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=600',
      isVeg: true, isSpicy: false, basePrice: 79, category: breadsCat, isPopular: true, prepTime: 8,
    },
    {
      name: 'Tandoori Roti',
      description: 'Whole wheat flatbread baked in the tandoor.',
      image: 'https://images.unsplash.com/photo-1604908554049-1c9bd3a0a8e3?w=600',
      isVeg: true, isSpicy: false, basePrice: 39, category: breadsCat, prepTime: 6,
    },
    {
      name: 'Laccha Paratha',
      description: 'Multi-layered flaky whole wheat paratha.',
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600',
      isVeg: true, isSpicy: false, basePrice: 69, category: breadsCat, prepTime: 8,
    },
    // ---- Beverages ----
    {
      name: 'Masala Chai',
      description: 'Indian spiced tea brewed with milk, ginger, cardamom and spices.',
      image: 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=600',
      isVeg: true, isSpicy: false, basePrice: 49, category: beveragesCat, prepTime: 5,
    },
    {
      name: 'Sweet Lassi',
      description: 'Chilled yogurt drink blended with sugar and a hint of cardamom.',
      image: 'https://images.unsplash.com/photo-1626078436898-7c2c9f3d6e6e?w=600',
      isVeg: true, isSpicy: false, basePrice: 89, category: beveragesCat, isPopular: true, prepTime: 5,
      variants: [
        { name: 'Regular', priceModifier: 0, isDefault: true },
        { name: 'Large',   priceModifier: 40 },
      ],
    },
    {
      name: 'Coca-Cola',
      description: 'Chilled 300ml bottle.',
      image: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=600',
      isVeg: true, isSpicy: false, basePrice: 60, category: beveragesCat, prepTime: 2,
      variants: [
        { name: '300ml', priceModifier: 0, isDefault: true },
        { name: '500ml', priceModifier: 30 },
        { name: '750ml', priceModifier: 60 },
      ],
    },
    {
      name: 'Fresh Lime Soda',
      description: 'Refreshing lime juice with soda — sweet, salted or mixed.',
      image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600',
      isVeg: true, isSpicy: false, basePrice: 79, category: beveragesCat, prepTime: 4,
      variants: [
        { name: 'Sweet', priceModifier: 0, isDefault: true },
        { name: 'Salted', priceModifier: 0 },
        { name: 'Mixed', priceModifier: 10 },
      ],
    },
    {
      name: 'Filter Coffee',
      description: 'Authentic South Indian filter coffee served in a steel tumbler.',
      image: 'https://images.unsplash.com/photo-1581006852262-e4307cf6283a?w=600',
      isVeg: true, isSpicy: false, basePrice: 69, category: beveragesCat, prepTime: 5,
    },
    // ---- Desserts ----
    {
      name: 'Gulab Jamun (2 pcs)',
      description: 'Warm milk-solid dumplings soaked in rose-cardamom sugar syrup.',
      image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600',
      isVeg: true, isSpicy: false, basePrice: 99, category: dessertsCat, isPopular: true, prepTime: 5,
    },
    {
      name: 'Rasmalai (2 pcs)',
      description: 'Soft cottage cheese discs soaked in saffron-cardamom flavored milk.',
      image: 'https://images.unsplash.com/photo-1633381373573-5b4968b80be4?w=600',
      isVeg: true, isSpicy: false, basePrice: 119, category: dessertsCat, prepTime: 5,
    },
    {
      name: 'Ice Cream Scoop',
      description: 'Choose from vanilla, chocolate, strawberry or mango.',
      image: 'https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?w=600',
      isVeg: true, isSpicy: false, basePrice: 89, category: dessertsCat, prepTime: 3,
      variants: [
        { name: 'Vanilla', priceModifier: 0, isDefault: true },
        { name: 'Chocolate', priceModifier: 10 },
        { name: 'Strawberry', priceModifier: 10 },
        { name: 'Mango', priceModifier: 20 },
      ],
    },
  ]

  for (const item of items) {
    const created = await db.menuItem.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: item.category.id,
        name: item.name,
        description: item.description,
        image: item.image,
        isVeg: item.isVeg,
        isSpicy: item.isSpicy,
        basePrice: item.basePrice,
        taxRate: restaurant.taxRate,
        available: true,
        soldOut: false,
        isFeatured: item.isFeatured || false,
        isPopular: item.isPopular || false,
        tags: item.tags,
        prepTime: item.prepTime || 15,
        sortOrder: 0,
        variants: item.variants
          ? { create: item.variants }
          : undefined,
      },
    })
    // Attach modifier groups (require MenuItemModifierGroup junction via menuItemId)
    if (item.modifierGroupIds?.length) {
      for (const groupId of item.modifierGroupIds) {
        await db.modifierGroup.update({
          where: { id: groupId },
          data: { menuItemId: created.id },
        })
      }
    }
  }
  console.log(`  ✓ Created ${items.length} menu items with variants and modifier groups`)

  // ------------------------------------------------------ Sample orders (3)
  // Create some demo orders so the dashboard isn't empty on first load
  const table1 = await db.table.findFirst({ where: { number: 'T1' } })
  const table2 = await db.table.findFirst({ where: { number: 'T2' } })
  const table3 = await db.table.findFirst({ where: { number: 'T3' } })

  if (table1 && table2 && table3) {
    const chickenBiryani = await db.menuItem.findFirst({ where: { name: 'Chicken Biryani' } })
    const coke = await db.menuItem.findFirst({ where: { name: 'Coca-Cola' } })
    const butterChicken = await db.menuItem.findFirst({ where: { name: 'Butter Chicken' } })
    const naan = await db.menuItem.findFirst({ where: { name: 'Butter Naan' } })

    if (chickenBiryani && coke && butterChicken && naan) {
      // Order 1: completed today
      const customer1 = await db.customer.create({
        data: { restaurantId: restaurant.id, name: 'Walk-in Guest', phone: null },
      })
      const subtotal1 = chickenBiryani.basePrice + coke.basePrice
      const tax1 = +(subtotal1 * restaurant.taxRate).toFixed(2)
      const total1 = +(subtotal1 + tax1).toFixed(2)
      const placed1 = new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 hours ago
      const o1 = await db.order.create({
        data: {
          orderNumber: 'SG-000001',
          restaurantId: restaurant.id,
          branchId: branch.id,
          tableId: table1.id,
          customerId: customer1.id,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          paymentMethod: 'UPI',
          subtotal: subtotal1,
          taxAmount: tax1,
          grandTotal: total1,
          placedAt: placed1,
          acceptedAt: new Date(placed1.getTime() + 60_000),
          preparingAt: new Date(placed1.getTime() + 120_000),
          readyAt: new Date(placed1.getTime() + 25 * 60_000),
          servedAt: new Date(placed1.getTime() + 27 * 60_000),
          completedAt: new Date(placed1.getTime() + 35 * 60_000),
          acceptedById: manager.id,
          servedById: waiter1.id,
          items: {
            create: [
              {
                menuItemId: chickenBiryani.id, menuItemName: chickenBiryani.name,
                menuItemImage: chickenBiryani.image, quantity: 1,
                basePrice: chickenBiryani.basePrice, variantPrice: 0, modifiersTotal: 0,
                unitPrice: chickenBiryani.basePrice, totalPrice: chickenBiryani.basePrice, isVeg: chickenBiryani.isVeg,
              },
              {
                menuItemId: coke.id, menuItemName: coke.name, menuItemImage: coke.image,
                quantity: 2, basePrice: coke.basePrice, variantPrice: 0, modifiersTotal: 0,
                unitPrice: coke.basePrice, totalPrice: coke.basePrice * 2, isVeg: coke.isVeg,
              },
            ],
          },
        },
      })
      await db.payment.create({
        data: {
          orderId: o1.id, restaurantId: restaurant.id, method: 'UPI', status: 'PAID',
          amount: total1, currency: 'INR', provider: 'RAZORPAY',
          providerTxnId: 'pay_demo_0001', verifiedAt: new Date(), verifiedById: cashier.id,
        },
      })

      // Order 2: in PREPARING
      const customer2 = await db.customer.create({
        data: { restaurantId: restaurant.id, name: 'Walk-in Guest', phone: null },
      })
      const subtotal2 = butterChicken.basePrice + naan.basePrice * 2
      const tax2 = +(subtotal2 * restaurant.taxRate).toFixed(2)
      const total2 = +(subtotal2 + tax2).toFixed(2)
      const placed2 = new Date(Date.now() - 8 * 60 * 1000) // 8 min ago
      const o2 = await db.order.create({
        data: {
          orderNumber: 'SG-000002',
          restaurantId: restaurant.id,
          branchId: branch.id,
          tableId: table2.id,
          customerId: customer2.id,
          status: 'PREPARING',
          paymentStatus: 'PENDING',
          subtotal: subtotal2,
          taxAmount: tax2,
          grandTotal: total2,
          placedAt: placed2,
          acceptedAt: new Date(placed2.getTime() + 30_000),
          preparingAt: new Date(placed2.getTime() + 90_000),
          acceptedById: manager.id,
          items: {
            create: [
              {
                menuItemId: butterChicken.id, menuItemName: butterChicken.name,
                menuItemImage: butterChicken.image, quantity: 1,
                basePrice: butterChicken.basePrice, variantPrice: 0, modifiersTotal: 0,
                unitPrice: butterChicken.basePrice, totalPrice: butterChicken.basePrice, isVeg: butterChicken.isVeg,
              },
              {
                menuItemId: naan.id, menuItemName: naan.name, menuItemImage: naan.image,
                quantity: 2, basePrice: naan.basePrice, variantPrice: 0, modifiersTotal: 0,
                unitPrice: naan.basePrice, totalPrice: naan.basePrice * 2, isVeg: naan.isVeg,
              },
            ],
          },
        },
      })
      await db.table.update({ where: { id: table2.id }, data: { status: 'FOOD_PREPARING' } })

      // Order 3: NEW (just placed, kitchen hasn't accepted)
      const customer3 = await db.customer.create({
        data: { restaurantId: restaurant.id, name: 'Walk-in Guest', phone: null },
      })
      const subtotal3 = chickenBiryani.basePrice * 2
      const tax3 = +(subtotal3 * restaurant.taxRate).toFixed(2)
      const total3 = +(subtotal3 + tax3).toFixed(2)
      const placed3 = new Date(Date.now() - 90 * 1000) // 90 sec ago
      await db.order.create({
        data: {
          orderNumber: 'SG-000003',
          restaurantId: restaurant.id,
          branchId: branch.id,
          tableId: table3.id,
          customerId: customer3.id,
          status: 'NEW',
          paymentStatus: 'PENDING',
          subtotal: subtotal3,
          taxAmount: tax3,
          grandTotal: total3,
          placedAt: placed3,
          items: {
            create: [
              {
                menuItemId: chickenBiryani.id, menuItemName: chickenBiryani.name,
                menuItemImage: chickenBiryani.image, quantity: 2,
                basePrice: chickenBiryani.basePrice, variantPrice: 0, modifiersTotal: 0,
                unitPrice: chickenBiryani.basePrice, totalPrice: chickenBiryani.basePrice * 2,
                isVeg: chickenBiryani.isVeg,
              },
            ],
          },
        },
      })
      await db.table.update({ where: { id: table3.id }, data: { status: 'ORDERING' } })

      console.log('  ✓ Created 3 sample orders (1 completed, 1 preparing, 1 new)')
    }
  }

  console.log('\n✅ Seed complete!\n')
  console.log('Demo logins (password for all: password123):')
  console.log('  Super Admin    : admin@platform.com')
  console.log('  Owner          : owner@spicegarden.in')
  console.log('  Manager        : manager@spicegarden.in')
  console.log('  Kitchen Staff  : chef1@spicegarden.in')
  console.log('  Waiter         : waiter1@spicegarden.in')
  console.log('  Cashier        : cashier@spicegarden.in')
  console.log('\nSample customer scan URL:')
  console.log('  /?table=sg-1-xxxxxxxxxx  (use any QR token from DB)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
