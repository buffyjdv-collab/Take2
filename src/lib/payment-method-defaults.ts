/**
 * Default catalog of payment-method presets (Zepto-style).
 *
 * Used by:
 *  - the settings UI ("Add payment method" picker shows these as templates)
 *  - the seed script (initial payment methods for Spice Garden)
 *  - the customer checkout UI (icon/label fallbacks)
 *
 * Each preset defines a `type` that drives the runtime payment flow.
 */
export type PaymentMethodType =
  | 'UPI'
  | 'QR'
  | 'CARD'
  | 'WALLET'
  | 'NETBANKING'
  | 'CASH'
  | 'COUNTER'
  | 'PAY_LATER'
  | 'CUSTOM'

export interface PaymentMethodPreset {
  type: PaymentMethodType
  label: string
  description: string
  icon: string // lucide-react icon name
  accentColor: string
  priority: number
  /** Default config (restaurants can override on edit) */
  config?: Record<string, unknown>
}

/**
 * Catalog of pre-built payment-method templates the restaurant owner can
 * pick from when adding a new payment option in Settings. Each is opinionated
 * about icon + accent color to match the Zepto-style visual language.
 */
export const PAYMENT_METHOD_PRESETS: PaymentMethodPreset[] = [
  {
    type: 'UPI',
    label: 'UPI',
    description: 'GPay / PhonePe / Paytm / BHIM',
    icon: 'Smartphone',
    accentColor: '#7C3AED', // violet-600
    priority: 10,
    config: { upiId: '' },
  },
  {
    type: 'QR',
    label: 'Scan QR Code',
    description: 'Scan our QR with any UPI app',
    icon: 'QrCode',
    accentColor: '#9333EA', // purple-600
    priority: 20,
    config: {},
  },
  {
    type: 'CARD',
    label: 'Credit / Debit Card',
    description: 'Visa · Mastercard · RuPay · Amex',
    icon: 'CreditCard',
    accentColor: '#2563EB', // blue-600
    priority: 30,
    config: { provider: 'MOCK' },
  },
  {
    type: 'WALLET',
    label: 'Mobile Wallet',
    description: 'PhonePe · Paytm · Mobikwik · Amazon Pay',
    icon: 'Wallet',
    accentColor: '#F59E0B', // amber-500
    priority: 40,
    config: { provider: 'MOCK' },
  },
  {
    type: 'NETBANKING',
    label: 'Net Banking',
    description: 'All major Indian banks supported',
    icon: 'Building2',
    accentColor: '#0891B2', // cyan-600
    priority: 50,
    config: { provider: 'MOCK' },
  },
  {
    type: 'CASH',
    label: 'Pay in Cash',
    description: 'Hand cash to your waiter — they will mark it paid',
    icon: 'Banknote',
    accentColor: '#16A34A', // green-600
    priority: 60,
    config: {},
  },
  {
    type: 'COUNTER',
    label: 'Pay at Counter',
    description: 'Pay by cash or card at the billing counter',
    icon: 'Store',
    accentColor: '#DB2777', // pink-600
    priority: 70,
    config: {},
  },
  {
    type: 'PAY_LATER',
    label: 'Pay Later',
    description: 'Settle your bill before leaving the table',
    icon: 'Clock',
    accentColor: '#EA580C', // orange-600
    priority: 80,
    config: {},
  },
  {
    type: 'CUSTOM',
    label: 'Custom Method',
    description: 'Define your own payment flow',
    icon: 'Plus',
    accentColor: '#64748B', // slate-500
    priority: 999,
    config: {},
  },
]

/**
 * Default payment-method rows seeded for a new restaurant. We seed the most
 * common Indian restaurant set: UPI + Cash + Pay at counter (active by
 * default). Card / Wallet / Net Banking / Pay Later are seeded but inactive —
 * the owner flips the toggle in Settings to expose them.
 */
export function defaultSeededPaymentMethods(upiId?: string | null) {
  const upi = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'UPI')!
  const cash = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'CASH')!
  const counter = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'COUNTER')!
  const card = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'CARD')!
  const wallet = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'WALLET')!
  const netbanking = PAYMENT_METHOD_PRESETS.find((p) => p.type === 'NETBANKING')!

  return [
    { ...upi, active: true, config: { upiId: upiId || '' } },
    { ...cash, active: true },
    { ...counter, active: true },
    { ...card, active: false },
    { ...wallet, active: false },
    { ...netbanking, active: false },
  ]
}

/**
 * Map a RestaurantPaymentMethod.type to the canonical Payment.method value
 * used by the existing Payment / initiate API. Cash + Counter stay as-is;
 * everything else is recorded as the type (the initiate API will accept any
 * type from the new picker).
 */
export function toApiPaymentMethod(type: PaymentMethodType): string {
  switch (type) {
    case 'UPI':
    case 'QR':
      return 'UPI'
    case 'CARD':
    case 'WALLET':
    case 'NETBANKING':
    case 'PAY_LATER':
    case 'CUSTOM':
      return type
    case 'CASH':
    case 'COUNTER':
      return type
    default:
      return type
  }
}

/**
 * Map a RestaurantPaymentMethod.type to a Payment.provider value (kept for
 * legacy reporting compatibility — the admin payments report groups by provider).
 */
export function toApiPaymentProvider(
  type: PaymentMethodType,
  config: Record<string, unknown> | null | undefined,
): string {
  const provider = (config as any)?.provider
  if (typeof provider === 'string' && provider.length > 0) return provider
  switch (type) {
    case 'UPI':
    case 'QR':
      return 'UPI'
    case 'CARD':
      return 'MOCK'
    case 'WALLET':
      return 'MOCK'
    case 'NETBANKING':
      return 'MOCK'
    case 'CASH':
      return 'CASH'
    case 'COUNTER':
      return 'COUNTER'
    case 'PAY_LATER':
    case 'CUSTOM':
      return 'MOCK'
    default:
      return 'MOCK'
  }
}
