'use client'

/**
 * Zepto-style payment method picker.
 *
 * Renders one card per active `RestaurantPaymentMethod` row, sorted by
 * priority. Each card has a colored icon chip + label + sub-description,
 * and is wired to call `onSelect(method)` when tapped.
 *
 * Visual states per row:
 *   - Default          : white card with slate border
 *   - Hover            : shadow + slight border tint
 *   - Selected         : accent-colored border (2px), accent-tinted background,
 *                         and a check icon on the right (Zepto-style — replaces
 *                         the default chevron when a method is chosen)
 *   - Disabled         : 50% opacity, not-allowed cursor (e.g. UPI with no VPA)
 *
 * Filtering:
 *   - `hiddenMethodIds` lets the caller hide specific payment-method rows.
 *     Used by order-tracking to hide the "Pay on delivery" method the
 *     customer already chose at order placement — they shouldn't see the
 *     same option again when prompted to settle the bill post-serve.
 *
 * Behavior (caller-driven):
 *   - UPI        → caller triggers deep-link launch (handled in checkout-sheet)
 *   - QR         → caller shows QR display
 *   - CARD       → caller initiates mock card payment
 *   - WALLET     → caller initiates mock wallet payment
 *   - NETBANKING → caller initiates mock netbanking payment
 *   - PAY_LATER  → caller creates order without payment (post-paid)
 *   - COUNTER    → caller shows "please pay at the counter" toast
 *   - CASH       → caller shows "please hand cash to your waiter" toast
 *   - CUSTOM     → caller treats as informational
 */
import { motion } from 'framer-motion'
import { ChevronRight, Check } from 'lucide-react'
import type { PaymentMethodT } from './types'
import {
  Smartphone,
  QrCode,
  CreditCard,
  Wallet,
  Building2,
  Banknote,
  Store,
  Clock,
  Plus,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Smartphone,
  QrCode,
  CreditCard,
  Wallet,
  Building2,
  Banknote,
  Store,
  Clock,
  Plus,
}

interface Props {
  methods: PaymentMethodT[]
  onSelect: (method: PaymentMethodT) => void
  disabled?: boolean
  /** Show a small "Recommended" pill on the first method (Zepto does this) */
  recommendFirst?: boolean
  /** Compact mode — smaller cards, used in inline "please pay" panels */
  compact?: boolean
  /** ID of the currently-selected method — renders a highlighted border +
   *  check icon on that row. */
  selectedMethodId?: string | null
  /** IDs of methods to HIDE from the picker. Used by order-tracking to hide
   *  the "Pay on delivery" method the customer already chose at order
   *  placement, so they're not asked to pick it again post-serve. */
  hiddenMethodIds?: string[]
}

export function PaymentMethodPicker({
  methods,
  onSelect,
  disabled = false,
  recommendFirst = true,
  compact = false,
  selectedMethodId = null,
  hiddenMethodIds = [],
}: Props) {
  // Filter out hidden methods (e.g. the pay-on-delivery method already chosen)
  const visibleMethods = methods.filter(
    (m) => !hiddenMethodIds.includes(m.id),
  )

  if (!visibleMethods || visibleMethods.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-[13px] text-amber-800">
        {methods.length === 0
          ? 'This restaurant has not configured any payment methods yet. Please ask the staff for assistance.'
          : 'No other payment methods available. Please ask the staff for assistance.'}
      </div>
    )
  }

  // The "Recommended" badge should appear on the first VISIBLE method,
  // not the original first method (otherwise a hidden method could steal it).
  const recommendIdx = 0

  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'sm:gap-2.5'}`}>
      {visibleMethods.map((m, idx) => {
        const Icon = ICON_MAP[m.icon || ''] || CreditCard
        const isSelected = selectedMethodId === m.id
        const disabledRow =
          disabled ||
          // UPI / QR are disabled if no upiId is configured anywhere
          ((m.type === 'UPI' || m.type === 'QR') &&
            !(m.config?.upiId || m.config?.payload))

        return (
          <motion.button
            key={m.id}
            type="button"
            disabled={disabledRow}
            onClick={() => onSelect(m)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.18 }}
            whileTap={{ scale: disabledRow ? 1 : 0.98 }}
            className={`group relative flex w-full items-center gap-3.5 rounded-xl border-2 bg-white text-left transition-all
              ${compact ? 'p-3' : 'p-3.5'}
              ${
                disabledRow
                  ? 'cursor-not-allowed border-slate-100 opacity-50'
                  : isSelected
                    ? 'border-transparent shadow-md'
                    : 'border-slate-200 hover:border-transparent hover:shadow-md hover:shadow-slate-200/60'
              }
            `}
            style={
              isSelected
                ? {
                    // Selected: accent-colored 2px border + tinted background
                    borderColor: m.accentColor,
                    backgroundColor: `${m.accentColor}0D`, // ~5% alpha tint
                  }
                : {
                    // tint the hover border with the brand accent color
                    ['--tw-ring-color' as any]: m.accentColor,
                  }
            }
          >
            {/* Color-tinted icon chip */}
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-9 w-9' : 'h-11 w-11'} transition-colors`}
              style={{
                backgroundColor: isSelected
                  ? m.accentColor
                  : `${m.accentColor}1A`, // 10% alpha tint
              }}
            >
              <Icon
                className={compact ? 'h-4 w-4' : 'h-5 w-5'}
                style={{
                  color: isSelected ? '#ffffff' : m.accentColor,
                }}
                strokeWidth={2.25}
              />
            </div>

            {/* Label + sub-description */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className={`truncate font-semibold text-slate-800 ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
                  {m.label}
                </p>
                {recommendFirst && idx === recommendIdx && !disabledRow && !isSelected && (
                  <span
                    className="rounded-full px-2 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: `${m.accentColor}1A`,
                      color: m.accentColor,
                    }}
                  >
                    Recommended
                  </span>
                )}
                {/* Selected pill — replaces the "Recommended" pill on the selected row */}
                {isSelected && (
                  <span
                    className="rounded-full px-2 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: m.accentColor,
                      color: '#ffffff',
                    }}
                  >
                    Selected
                  </span>
                )}
              </div>
              {m.description && (
                <p className={`truncate text-slate-400 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
                  {m.description}
                </p>
              )}
            </div>

            {/* Right-side affordance: check icon when selected, chevron otherwise */}
            {isSelected ? (
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: m.accentColor }}
              >
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              </div>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

/**
 * Convenience helper: filter a list of payment methods down to the ones that
 * should be visible at the cart / pre-payment step. Today this is everything,
 * but we keep it as a chokepoint in case future logic excludes disabled types.
 */
export function filterAvailableForCheckout(methods: PaymentMethodT[] | undefined): PaymentMethodT[] {
  if (!methods) return []
  return [...methods].sort((a, b) => a.priority - b.priority)
}

/**
 * Identify "pay-on-delivery" methods — ones where the customer pays LATER,
 * in person, after the order is served. These should be hidden from the
 * post-serve payment picker if the customer already chose one at order
 * placement (otherwise they'd be asked to pick it again — confusing UX).
 *
 * Pay-on-delivery types: CASH, COUNTER, PAY_LATER
 */
export const PAY_ON_DELIVERY_TYPES = ['CASH', 'COUNTER', 'PAY_LATER']

export function isPayOnDelivery(method: PaymentMethodT | undefined | null): boolean {
  if (!method) return false
  return PAY_ON_DELIVERY_TYPES.includes(method.type)
}

