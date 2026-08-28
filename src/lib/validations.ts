import { z } from 'zod'

// Customer-side order placement
export const createOrderItemSchema = z.object({
  menuItemId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  modifierIds: z.array(z.string()).optional().default([]),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(280).optional(),
})

// Validate a phone number: 7–15 digits, optional leading +, spaces/dashes ignored.
const phoneRegex = /^\+?[\d\s\-()]{7,20}$/
export const phoneSchema = z
  .string()
  .min(7, 'Phone number is required (min 7 digits)')
  .max(20)
  .regex(phoneRegex, 'Please enter a valid phone number')

export const createOrderSchema = z.object({
  tableToken: z.string().min(1),
  items: z.array(createOrderItemSchema).min(1).max(50),
  // Customer name & phone are now REQUIRED at order placement (replaces the
  // old "order notes" prompt). The restaurant uses these to contact the
  // customer about their order and to fulfil pre-payment requirements.
  customerInfo: z.object({
    name: z
      .string()
      .min(2, 'Please enter your name')
      .max(80, 'Name is too long (max 80 characters)'),
    phone: phoneSchema,
    email: z.string().email().optional().or(z.literal('')),
  }),
  idempotencyKey: z.string().min(8).max(120),
  notes: z.string().max(500).optional(),
  /** Optional: ID of the RestaurantPaymentMethod row the customer chose at
   *  checkout. Persisted on the Order so the post-serve payment picker can
   *  hide the same pay-on-delivery method (Cash/Counter/Pay Later) if the
   *  customer already picked it at placement time. */
  paymentMethodId: z.string().optional().nullable(),
})

// Service request
export const createServiceRequestSchema = z.object({
  tableToken: z.string().min(1),
  orderId: z.string().optional(),
  type: z.enum(['CALL_WAITER', 'REQUEST_BILL', 'WATER', 'CLEANUP', 'CUSTOM']),
  notes: z.string().max(280).optional(),
})

// Payment initiation
// `method` can be any of the RestaurantPaymentMethod.type values, plus
// 'CASH' / 'COUNTER' for the legacy waiter-mark-paid flow.
export const initiatePaymentSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum([
    'UPI',
    'QR',
    'CARD',
    'WALLET',
    'NETBANKING',
    'CASH',
    'COUNTER',
    'PAY_LATER',
    'CUSTOM',
  ]),
  // Optional: id of the RestaurantPaymentMethod the customer tapped.
  // Lets the initiate route read the per-method config (UPI ID, provider etc.)
  paymentMethodId: z.string().optional(),
})

export const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1),
  providerTxnId: z.string().min(1),
})

// ============================================================================
// RESTAURANT PAYMENT METHODS — ZEPTO-STYLE CONFIGURABLE PAYMENT TYPES
// ============================================================================
export const PAYMENT_METHOD_TYPES = [
  'UPI',
  'QR',
  'CARD',
  'WALLET',
  'NETBANKING',
  'CASH',
  'COUNTER',
  'PAY_LATER',
  'CUSTOM',
] as const

// Create a new payment method for a restaurant
export const createPaymentMethodSchema = z.object({
  type: z.enum(PAYMENT_METHOD_TYPES),
  label: z.string().min(1, 'Label is required').max(60),
  description: z.string().max(180).optional().nullable(),
  icon: z.string().max(60).optional().nullable(),
  accentColor: z
    .string()
    .max(9)
    .regex(/^#[0-9a-fA-F]{3,8}$/, 'Accent color must be a hex color (e.g. #EA580C)')
    .optional()
    .nullable(),
  active: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  config: z.record(z.string(), z.any()).optional().nullable(),
})

// Update an existing payment method
export const updatePaymentMethodSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  description: z.string().max(180).optional().nullable(),
  icon: z.string().max(60).optional().nullable(),
  accentColor: z
    .string()
    .max(9)
    .regex(/^#[0-9a-fA-F]{3,8}$/, 'Accent color must be a hex color')
    .optional()
    .nullable(),
  active: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  config: z.record(z.string(), z.any()).optional().nullable(),
})

// Reorder payment methods (batch update priorities)
export const reorderPaymentMethodsSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(100),
})

// Admin: order status update
export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'NEW',
    'ACCEPTED',
    'PREPARING',
    'READY',
    'SERVED',
    'COMPLETED',
    'CANCELLED',
  ]),
  cancelReason: z.string().max(280).optional(),
})

// Admin: menu category
export const menuCategorySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  icon: z.string().max(20).optional(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
})

// Admin: menu variant
export const menuVariantSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(40),
  priceModifier: z.number().min(-10000).max(10000),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

// Admin: modifier
export const modifierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(40),
  price: z.number().min(0).max(10000),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

// Admin: modifier group
export const modifierGroupSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  selectionType: z.enum(['SINGLE', 'MULTIPLE']),
  required: z.boolean().optional(),
  minSelection: z.number().int().min(0).max(20).optional(),
  maxSelection: z.number().int().min(1).max(50).optional(),
  sortOrder: z.number().int().min(0).optional(),
  menuItemId: z.string().optional().nullable(),
  modifiers: z.array(modifierSchema).optional(),
})

// Admin: menu item
// Image may be:
//   - empty string
//   - null (coerced to '' — happens when loading an item with no image from DB)
//   - a public URL (https://…)
//   - a data URL (data:image/...;base64,…) uploaded via /api/admin/upload
export const menuItemImageSchema = z
  .union([z.string(), z.null()])
  .transform((v) => (v == null ? '' : v))
  .pipe(
    z
      .string()
      .max(7_500_000, 'Image payload too large (max 5MB for data URLs)')
      .refine(
        (v) =>
          v === '' ||
          /^https?:\/\//i.test(v) ||
          /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(v),
        'Image must be a URL or a data URL',
      ),
  )
  .optional()
  .or(z.literal(''))

export const menuItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  image: menuItemImageSchema,
  categoryId: z.string().min(1),
  isVeg: z.boolean().optional(),
  isSpicy: z.boolean().optional(),
  basePrice: z.number().min(0).max(100000),
  taxRate: z.number().min(0).max(1).optional(),
  available: z.boolean().optional(),
  soldOut: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  prepTime: z.number().int().min(0).max(600).optional(),
  tags: z.string().max(280).optional(),
  sortOrder: z.number().int().min(0).optional(),
  variants: z.array(menuVariantSchema).optional(),
  modifierGroupIds: z.array(z.string()).optional(),
})

// Admin: table
export const tableSchema = z.object({
  number: z.string().min(1).max(20),
  label: z.string().max(60).optional().nullable(),
  capacity: z.number().int().min(1).max(50),
  active: z.boolean().optional(),
  branchId: z.string().optional().nullable(),
})

// Admin: staff
export const ALL_ROLES = [
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'MANAGER',
  'KITCHEN_STAFF',
  'WAITER',
  'CASHIER',
] as const

export const NON_SUPER_ROLES = [
  'RESTAURANT_OWNER',
  'MANAGER',
  'KITCHEN_STAFF',
  'WAITER',
  'CASHIER',
] as const

export const staffCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(120),
  role: z.enum(ALL_ROLES),
  branchId: z.string().optional().nullable(),
  phone: z.string().max(20).optional(),
})

export const staffUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(ALL_ROLES).optional(),
  active: z.boolean().optional(),
  branchId: z.string().optional().nullable(),
  phone: z.string().max(20).optional(),
  password: z.string().min(6).max(120).optional(),
})

// Helper: accept string, null, or undefined → returns string or undefined.
// Used for fields that come back as null from the DB but the schema expects
// a string (or empty string). Without this, sending `null` for `logo` / `email`
// / `website` triggers "expected string, received null" validation errors.
const nullableString = z
  .union([z.string(), z.null()])
  .transform((v) => (v == null ? '' : v))
  .optional()

// Admin: settings
export const settingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  tagline: nullableString,
  description: nullableString,
  address: nullableString,
  phone: nullableString,
  email: z
    .union([z.string(), z.null()])
    .transform((v) => (v == null ? '' : v))
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Invalid email'),
  website: nullableString,
  logo: z
    .union([z.string(), z.null()])
    .transform((v) => (v == null ? '' : v))
    .refine((v) => v === '' || z.string().url().safeParse(v).success, 'Invalid URL'),
  gstNumber: nullableString,
  panNumber: nullableString,
  taxRate: z.number().min(0).max(1).optional(),
  serviceChargeRate: z.number().min(0).max(1).optional(),
  openingTime: nullableString,
  closingTime: nullableString,
  isOpen: z.boolean().optional(),
  acceptUpi: z.boolean().optional(),
  acceptCard: z.boolean().optional(),
  acceptCash: z.boolean().optional(),
  acceptCounter: z.boolean().optional(),
  primaryColor: nullableString,
  accentColor: nullableString,
  upiId: nullableString,
  settings: z
    .object({
      receiptHeader: nullableString,
      receiptFooter: nullableString,
      showLogoOnReceipt: z.boolean().optional(),
      notifyKitchenOnNewOrder: z.boolean().optional(),
      notifyWaiterOnBillRequest: z.boolean().optional(),
      playSoundOnNewOrder: z.boolean().optional(),
      autoAcceptOrders: z.boolean().optional(),
      allowCallWaiter: z.boolean().optional(),
      allowRequestBill: z.boolean().optional(),
      maxItemsPerOrder: z.number().int().min(1).max(200).optional(),
      taxInclusive: z.boolean().optional(),
    })
    .optional(),
})

// Restaurant owner / cashier: request payment from customer at any point.
// `when` controls the customer-facing prompt:
//   - 'PRE':  "Please pay before we accept your order"
//   - 'POST': "Please pay now that your order has been received"
export const requestPaymentSchema = z.object({
  when: z.enum(['PRE', 'POST']),
})

// ============================================================================
// MULTI-TENANT BUSINESS VALIDATIONS
// ============================================================================

// Public restaurant signup
export const signupSchema = z.object({
  // Restaurant info
  restaurantName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  tagline: z.string().max(120).optional(),
  address: z.string().min(5).max(280),
  city: z.string().min(2).max(80),
  phone: z.string().min(6).max(20),
  email: z.string().email(),
  // Owner account
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8).max(120),
  // Plan
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']).default('TRIAL'),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
})

// Platform: create tenant (super admin)
export const platformCreateTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  tagline: z.string().max(120).optional(),
  address: z.string().min(5).max(280),
  city: z.string().min(2).max(80).optional(),
  phone: z.string().min(6).max(20),
  email: z.string().email().optional().or(z.literal('')),
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']).default('TRIAL'),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  // Owner
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8).max(120).optional(), // optional: super admin can leave it and invite
})

// Platform: update tenant
export const platformUpdateTenantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  tagline: z.string().max(120).optional(),
  address: z.string().max(280).optional(),
  city: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  isOpen: z.boolean().optional(),
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
  subscriptionStatus: z
    .enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'])
    .optional(),
  suspendReason: z.string().max(280).optional(),
})

// Platform: change plan
export const changePlanSchema = z.object({
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
})
