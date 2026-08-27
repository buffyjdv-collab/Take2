'use client'

/**
 * Zepto-style payment method picker.
 *
 * Renders one card per active `RestaurantPaymentMethod` row, sorted by
 * priority. Each card has a colored icon chip + label + sub-description,
 * and is wired to call `onSelect(method)` when tapped.
 *
 * Behavior:
 *   - UPI        → caller triggers deep-link launch (handled in cart-drawer)
 *   - QR         → caller shows QR modal
 *   - CARD       → caller initiates mock card payment
 *   - WALLET     → caller initiates mock wallet payment
 *   - NETBANKING → caller initiates mock netbanking payment
 *   - PAY_LATER  → caller creates order without payment (post-paid)
 *   - COUNTER    → caller shows "please pay at the counter" toast
 *   - CASH       → caller shows "please hand cash to your waiter" toast
 *   - CUSTOM     → caller treats as informational
 */
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
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
}

export function PaymentMethodPicker({
  methods,
  onSelect,
  disabled = false,
  recommendFirst = true,
  compact = false,
}: Props) {
  if (!methods || methods.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-[13px] text-amber-800">
        This restaurant has not configured any payment methods yet.
        <br />
        Please ask the staff for assistance.
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'sm:gap-2.5'}`}>
      {methods.map((m, idx) => {
        const Icon = ICON_MAP[m.icon || ''] || CreditCard
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
            className={`group relative flex w-full items-center gap-3.5 rounded-xl border bg-white text-left transition-all
              ${compact ? 'p-3' : 'p-3.5'}
              ${
                disabledRow
                  ? 'cursor-not-allowed border-slate-100 opacity-50'
                  : 'border-slate-200 hover:border-transparent hover:shadow-md hover:shadow-slate-200/60'
              }
            `}
            style={{
              // tint the hover border with the brand accent color
              ['--tw-ring-color' as any]: m.accentColor,
            }}
          >
            {/* Color-tinted icon chip */}
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
              style={{
                backgroundColor: `${m.accentColor}1A`, // 10% alpha tint
              }}
            >
              <Icon
                className={compact ? 'h-4 w-4' : 'h-5 w-5'}
                style={{ color: m.accentColor }}
                strokeWidth={2.25}
              />
            </div>

            {/* Label + sub-description */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className={`truncate font-semibold text-slate-800 ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
                  {m.label}
                </p>
                {recommendFirst && idx === 0 && !disabledRow && (
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
              </div>
              {m.description && (
                <p className={`truncate text-slate-400 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
                  {m.description}
                </p>
              )}
            </div>

            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
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
