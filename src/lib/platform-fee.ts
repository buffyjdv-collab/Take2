/**
 * Platform Fee Calculation Engine
 *
 * Supports 4 fee types, 4 application bases, min/max caps, and 3 payer modes.
 * Used at order placement time to snapshot the fee onto the order.
 */
import { db } from '@/lib/db'

export type FeeType = 'PERCENTAGE' | 'FIXED_PER_ORDER' | 'MONTHLY_SUBSCRIPTION' | 'HYBRID'
export type AppliesTo =
  | 'FOOD_SUBTOTAL'
  | 'DISCOUNTED_SUBTOTAL'
  | 'TOTAL_EXCLUDING_TAX'
  | 'TOTAL_INCLUDING_TAX'
export type Payer = 'RESTAURANT' | 'CUSTOMER' | 'SPLIT'

export interface PlatformFeeConfig {
  feeType: FeeType
  percentageRate: number   // e.g. 0.5 means 0.5%
  fixedAmount: number      // paise
  monthlyAmount: number    // paise
  appliesTo: AppliesTo
  minimumFee: number       // paise
  maximumFee: number | null // paise
  payer: Payer
  customerSplitPct: number // 0-100
}

export interface OrderPricing {
  subtotal: number         // food subtotal (sum of item prices, before discount)
  discountAmount: number   // total discount applied
  taxAmount: number        // GST
  serviceCharge: number    // optional service charge
  grandTotal: number       // subtotal - discount + tax + serviceCharge
}

export interface FeeCalculation {
  feeType: FeeType
  percentageRate: number
  fixedAmount: number
  baseAmount: number       // rupees — the base the % was applied to
  grossFee: number         // rupees — fee before caps
  feeAmount: number        // rupees — final fee after min/max caps
  payer: Payer
  customerPortion: number  // rupees
  restaurantPortion: number // rupees
  minimumFeeApplied: boolean
  maximumFeeApplied: boolean
  skipped: boolean         // true if monthly subscription (no per-order fee)
  reason?: string
}

const DEFAULT_CONFIG: PlatformFeeConfig = {
  feeType: 'PERCENTAGE',
  percentageRate: 0.5,
  fixedAmount: 0,
  monthlyAmount: 0,
  appliesTo: 'TOTAL_EXCLUDING_TAX',
  minimumFee: 0,
  maximumFee: null,
  payer: 'RESTAURANT',
  customerSplitPct: 0,
}

/**
 * Get the active platform fee config. Creates a default row if none exists.
 */
export async function getPlatformFeeConfig(): Promise<PlatformFeeConfig> {
  const row = await db.platformFeeConfig.findFirst({
    where: { active: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) return DEFAULT_CONFIG
  return {
    feeType: row.feeType as FeeType,
    percentageRate: row.percentageRate,
    fixedAmount: row.fixedAmount,
    monthlyAmount: row.monthlyAmount,
    appliesTo: row.appliesTo as AppliesTo,
    minimumFee: row.minimumFee,
    maximumFee: row.maximumFee,
    payer: row.payer as Payer,
    customerSplitPct: row.customerSplitPct,
  }
}

/**
 * Compute the base amount the fee should be applied to.
 */
function getBaseAmount(pricing: OrderPricing, appliesTo: AppliesTo): number {
  switch (appliesTo) {
    case 'FOOD_SUBTOTAL':
      return pricing.subtotal
    case 'DISCOUNTED_SUBTOTAL':
      return Math.max(0, pricing.subtotal - pricing.discountAmount)
    case 'TOTAL_EXCLUDING_TAX':
      // subtotal - discount + serviceCharge (no tax)
      return Math.max(0, pricing.subtotal - pricing.discountAmount + pricing.serviceCharge)
    case 'TOTAL_INCLUDING_TAX':
      return pricing.grandTotal
    default:
      return pricing.grandTotal
  }
}

/**
 * Calculate the platform fee for an order.
 *
 * For MONTHLY_SUBSCRIPTION: returns skipped=true (no per-order fee; subscription is billed separately)
 * For PERCENTAGE: fee = baseAmount * (percentageRate / 100)
 * For FIXED_PER_ORDER: fee = fixedAmount (in rupees, converted from paise)
 * For HYBRID: fee = baseAmount * (percentageRate / 100) + fixedAmount
 *
 * Then applies min/max caps, then splits by payer.
 */
export function calculateOrderFee(
  pricing: OrderPricing,
  config: PlatformFeeConfig,
): FeeCalculation {
  // Monthly subscription doesn't charge per order
  if (config.feeType === 'MONTHLY_SUBSCRIPTION') {
    return {
      feeType: config.feeType,
      percentageRate: 0,
      fixedAmount: 0,
      baseAmount: 0,
      grossFee: 0,
      feeAmount: 0,
      payer: config.payer,
      customerPortion: 0,
      restaurantPortion: 0,
      minimumFeeApplied: false,
      maximumFeeApplied: false,
      skipped: true,
      reason: 'Monthly subscription — billed separately, not per order',
    }
  }

  const baseAmount = getBaseAmount(pricing, config.appliesTo)
  const fixedRupees = config.fixedAmount / 100

  let grossFee = 0
  if (config.feeType === 'PERCENTAGE') {
    grossFee = (baseAmount * config.percentageRate) / 100
  } else if (config.feeType === 'FIXED_PER_ORDER') {
    grossFee = fixedRupees
  } else if (config.feeType === 'HYBRID') {
    grossFee = (baseAmount * config.percentageRate) / 100 + fixedRupees
  }

  // Apply min/max caps (caps are in paise)
  const minRupees = config.minimumFee / 100
  const maxRupees = config.maximumFee ? config.maximumFee / 100 : null
  let feeAmount = grossFee
  let minimumFeeApplied = false
  let maximumFeeApplied = false

  if (feeAmount < minRupees) {
    feeAmount = minRupees
    minimumFeeApplied = true
  }
  if (maxRupees !== null && feeAmount > maxRupees) {
    feeAmount = maxRupees
    maximumFeeApplied = true
  }

  // Split by payer
  let customerPortion = 0
  let restaurantPortion = 0
  if (config.payer === 'RESTAURANT') {
    restaurantPortion = feeAmount
  } else if (config.payer === 'CUSTOMER') {
    customerPortion = feeAmount
  } else if (config.payer === 'SPLIT') {
    customerPortion = (feeAmount * config.customerSplitPct) / 100
    restaurantPortion = feeAmount - customerPortion
  }

  return {
    feeType: config.feeType,
    percentageRate: config.percentageRate,
    fixedAmount: config.fixedAmount,
    baseAmount: +baseAmount.toFixed(2),
    grossFee: +grossFee.toFixed(2),
    feeAmount: +feeAmount.toFixed(2),
    payer: config.payer,
    customerPortion: +customerPortion.toFixed(2),
    restaurantPortion: +restaurantPortion.toFixed(2),
    minimumFeeApplied,
    maximumFeeApplied,
    skipped: false,
  }
}

/**
 * Get a human-readable description of the fee config.
 */
export function describeFeeConfig(c: PlatformFeeConfig): string {
  const fmtPaise = (p: number) => `₹${(p / 100).toFixed(2)}`
  const fmtPct = (p: number) => `${p}%`
  const appliesToLabel: Record<AppliesTo, string> = {
    FOOD_SUBTOTAL: 'food subtotal',
    DISCOUNTED_SUBTOTAL: 'discounted subtotal',
    TOTAL_EXCLUDING_TAX: 'total excluding tax',
    TOTAL_INCLUDING_TAX: 'total including tax',
  }
  const payerLabel: Record<Payer, string> = {
    RESTAURANT: 'Restaurant pays',
    CUSTOMER: 'Customer pays',
    SPLIT: `Split ${c.customerSplitPct}/${100 - c.customerSplitPct} (customer/restaurant)`,
  }

  let desc = ''
  switch (c.feeType) {
    case 'PERCENTAGE':
      desc = `${fmtPct(c.percentageRate)} of ${appliesToLabel[c.appliesTo]}`
      break
    case 'FIXED_PER_ORDER':
      desc = `${fmtPaise(c.fixedAmount)} per order`
      break
    case 'MONTHLY_SUBSCRIPTION':
      desc = `${fmtPaise(c.monthlyAmount)}/month subscription`
      break
    case 'HYBRID':
      desc = `${fmtPct(c.percentageRate)} of ${appliesToLabel[c.appliesTo]} + ${fmtPaise(c.fixedAmount)} per order`
      break
  }

  const caps: string[] = []
  if (c.minimumFee > 0) caps.push(`min ${fmtPaise(c.minimumFee)}`)
  if (c.maximumFee !== null) caps.push(`max ${fmtPaise(c.maximumFee)}`)
  if (caps.length) desc += ` (${caps.join(', ')})`

  desc += `. ${payerLabel[c.payer]}.`
  return desc
}
