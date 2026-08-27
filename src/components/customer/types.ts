export interface MenuItemWithRelations {
  id: string
  name: string
  description?: string | null
  image?: string | null
  isVeg: boolean
  isSpicy: boolean
  basePrice: number
  taxRate: number
  available: boolean
  soldOut: boolean
  isFeatured: boolean
  isPopular: boolean
  prepTime: number
  tags?: string | null
  sortOrder: number
  category: { id: string; name: string; icon?: string | null }
  variants: MenuVariantT[]
  modifierGroups: ModifierGroupT[]
}

export interface MenuVariantT {
  id: string
  name: string
  priceModifier: number
  isDefault: boolean
  sortOrder: number
}

export interface ModifierGroupT {
  id: string
  name: string
  description?: string | null
  selectionType: 'SINGLE' | 'MULTIPLE'
  required: boolean
  minSelection: number
  maxSelection: number
  sortOrder: number
  modifiers: ModifierT[]
}

export interface ModifierT {
  id: string
  name: string
  price: number
  isDefault: boolean
  active: boolean
  sortOrder: number
}

export interface RestaurantInfo {
  id: string
  name: string
  logo?: string | null
  tagline?: string | null
  description?: string | null
  address: string
  phone: string
  isOpen: boolean
  openingTime: string
  closingTime: string
  currencySymbol: string
  primaryColor: string
  accentColor: string
  taxRate: number
  serviceChargeRate: number
  acceptUpi: boolean
  acceptCard: boolean
  acceptCash: boolean
  acceptCounter: boolean
  upiId?: string | null
  settings?: any
  /** Active payment-method rows, sorted by priority (Zepto-style). */
  paymentMethods?: PaymentMethodT[]
}

export interface PaymentMethodT {
  id: string
  type: string
  label: string
  description?: string | null
  icon?: string | null
  accentColor: string
  priority: number
  config?: any
}

export interface TableInfo {
  id: string
  number: string
  label?: string | null
  capacity: number
  status: string
}
