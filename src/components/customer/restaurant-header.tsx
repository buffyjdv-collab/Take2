'use client'

import { ArrowLeft, Search, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RestaurantInfo, TableInfo } from './types'
import { useCustomerCart } from '@/stores/customer-cart'

/**
 * resolveBrand
 * Safely coerces a restaurant's primary/accent colour string into something
 * usable by inline styles. Falls back to the Swiggy-style orange palette when
 * the restaurant has not configured a brand colour.
 */
function resolveBrand(color: string | null | undefined, fallback: string): string {
  if (!color || typeof color !== 'string') return fallback
  const trimmed = color.trim()
  if (!trimmed) return fallback
  // Accept hex, rgb(), rgba(), hsl(), hsla(), and CSS named colours.
  if (/^(#|rgb|hsl)/i.test(trimmed) || /^[a-z]+$/i.test(trimmed)) return trimmed
  return fallback
}

/**
 * RestaurantHeader
 * A single, simple sticky bar that stays pinned at the top of the page.
 * Background uses the restaurant's brand colours (primary → accent gradient,
 * orange fallback). Contains: back button, restaurant name, table + tagline,
 * search, cart. No separate scrolling hero block — keeps the customer menu
 * minimal and lets the category tabs + content take focus.
 *
 * Height is locked to 57px so the existing CategoryTabs sticky offset
 * (`top-[57px]`) still lines up exactly.
 */
export function RestaurantHeader({
  restaurant,
  table,
  onBackToMenu,
}: {
  restaurant: RestaurantInfo
  table: TableInfo
  onBackToMenu: () => void
}) {
  const itemCount = useCustomerCart((s) =>
    s.items.reduce((n, i) => n + i.quantity, 0),
  )

  const primary = resolveBrand(restaurant.primaryColor, '#ea580c') // orange-600
  const accent = resolveBrand(restaurant.accentColor, '#f97316') // orange-500

  // Single inline style for the brand gradient — keeps the component pure-CSS
  // and avoids needing any motion / scroll-listener machinery.
  const bgStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
  }

  return (
    <header
      className="sticky top-0 z-30 text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]"
      style={bgStyle}
    >
      <div className="mx-auto flex h-[57px] max-w-3xl items-center gap-2 px-3">
        {/* Back button */}
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 h-9 w-9 shrink-0 rounded-full text-white hover:bg-white/20"
          onClick={onBackToMenu}
          aria-label="Back to menu"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Restaurant name + table/tagline — clickable to return to menu */}
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={onBackToMenu}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onBackToMenu()
            }
          }}
        >
          <h1 className="truncate text-[15px] font-bold leading-tight">
            {restaurant.name}
          </h1>
          <p className="truncate text-[11px] leading-tight text-white/85">
            Table {table.number}
            {restaurant.tagline && (
              <>
                <span className="mx-1 opacity-60">·</span>
                {restaurant.tagline}
              </>
            )}
          </p>
        </div>

        {/* Search */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-white hover:bg-white/20"
          aria-label="Search menu"
        >
          <Search className="h-[18px] w-[18px]" />
        </Button>

        {/* Cart with badge */}
        {itemCount > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 shrink-0 rounded-full text-white hover:bg-white/20"
            aria-label="Cart"
          >
            <ShoppingBag className="h-[18px] w-[18px]" />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold leading-none text-orange-600 shadow ring-2 ring-orange-500/30">
              {itemCount}
            </span>
          </Button>
        )}
      </div>
    </header>
  )
}
