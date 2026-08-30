'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  UtensilsCrossed,
  Clock3,
  ReceiptText,
} from 'lucide-react'
import type { View } from './customer-app'

/**
 * CustomerBottomNav
 * Mobile-only bottom tab bar for the customer QR menu. Three tabs:
 *
 *   Menu  ·  Track  ·  Bill
 *
 * - Hidden on `md:` and up (desktop / tablet landscape uses the top
 *   header + scrolling menu only).
 * - Replaces the floating "Track order" pill — that pill is removed from
 *   customer-app.tsx when this nav is rendered.
 * - Sits *above* FloatingCartButton in the z-order but is itself
 *   `bottom-0`, so when the cart has items, FloatingCartButton is
 *   repositioned to sit just above this nav via a CSS variable
 *   (`--cart-bottom-offset`) set on the document root.
 *
 * Visual design:
 *  - 56px tall + safe-area inset
 *  - Frosted white background (bg-white/95 backdrop-blur)
 *  - Active tab: orange-600 icon + label, with a 3px pill indicator above
 *  - Inactive tabs: slate-500
 *  - Bill tab disabled (grayed + non-interactive) when no order has been
 *    placed yet — tapping shows a tiny hint.
 */

interface TabDef {
  key: View
  label: string
  icon: typeof UtensilsCrossed
}

const TABS: TabDef[] = [
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { key: 'track', label: 'Track', icon: Clock3 },
  { key: 'bill', label: 'Bill', icon: ReceiptText },
]

export function CustomerBottomNav({
  view,
  hasOrder,
  onNavigate,
}: {
  view: View
  hasOrder: boolean
  onNavigate: (v: View) => void
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-xl md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label="Customer navigation"
    >
      <div className="mx-auto flex h-14 max-w-md items-stretch">
        {TABS.map((tab) => {
          const active = view === tab.key
          const disabled = tab.key === 'bill' && !hasOrder
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                onNavigate(tab.key)
              }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors',
                active
                  ? 'text-orange-600'
                  : disabled
                    ? 'text-slate-300'
                    : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {/* Active indicator pill (top) */}
              {active && (
                <motion.span
                  layoutId="customer-bottom-nav-active"
                  className="absolute top-0 h-[3px] w-10 rounded-b-full bg-orange-600"
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                />
              )}
              <Icon
                className={cn('h-[18px] w-[18px]', active && 'stroke-[2.4]')}
                strokeWidth={active ? 2.4 : 2}
              />
              <span
                className={cn(
                  'text-[10px] font-semibold leading-none',
                  active ? 'text-orange-700' : 'text-slate-500',
                )}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
