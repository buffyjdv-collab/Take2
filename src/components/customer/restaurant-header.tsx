'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Search, ShoppingBag, Clock, MapPin, Star, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import type { RestaurantInfo, TableInfo } from './types'
import { useCustomerCart } from '@/stores/customer-cart'
import { cn } from '@/lib/utils'

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

  // Track whether the page has been scrolled, so the sticky top bar can switch
  // from transparent (over the hero) to a solid frosted-glass look.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const primary = resolveBrand(restaurant.primaryColor, '#ea580c') // orange-600
  const accent = resolveBrand(restaurant.accentColor, '#f97316') // orange-500

  // Derive a friendly initials avatar when no logo is set.
  const initials = restaurant.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  const heroBgStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
  }

  return (
    <header className="block">
      {/* ---------------------------------------------------------------- */}
      {/* Sticky top bar — always visible, becomes frosted once scrolled.  */}
      {/* Height is kept at 57px so the existing CategoryTabs sticky        */}
      {/* top-[57px] offset still lines up exactly.                         */}
      {/* The <header> is intentionally left as `static` (no `relative`)    */}
      {/* so the sticky bar's containing block is the outer page wrapper    */}
      {/* and it stays pinned for the entire scroll height.                 */}
      {/* ---------------------------------------------------------------- */}
      <motion.div
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn(
          'sticky top-0 z-30 transition-colors duration-300',
          scrolled
            ? 'bg-white/85 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] backdrop-blur-xl'
            : 'bg-transparent',
        )}
      >
        <div className="mx-auto flex h-[57px] max-w-3xl items-center gap-2 px-3">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 shrink-0 rounded-full',
              scrolled
                ? 'text-slate-700 hover:bg-slate-100'
                : 'text-white/95 hover:bg-white/20',
            )}
            onClick={onBackToMenu}
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {/* When scrolled, the restaurant name collapses into the sticky bar. */}
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
            {scrolled ? (
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-[15px] font-bold text-slate-900">
                  {restaurant.name}
                </h1>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  Table {table.number}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-white/95">
                <span className="text-[13px] font-medium">Table {table.number}</span>
                <span className="h-1 w-1 rounded-full bg-white/60" />
                <span className="text-[13px] font-medium">Dine-in</span>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 shrink-0 rounded-full',
              scrolled
                ? 'text-slate-600 hover:bg-slate-100'
                : 'text-white/95 hover:bg-white/20',
            )}
            aria-label="Search menu"
          >
            <Search className="h-[18px] w-[18px]" />
          </Button>

          {itemCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'relative h-9 w-9 shrink-0 rounded-full',
                scrolled
                  ? 'text-slate-600 hover:bg-slate-100'
                  : 'text-white/95 hover:bg-white/20',
              )}
              aria-label="Cart"
            >
              <ShoppingBag className="h-[18px] w-[18px]" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-white shadow ring-2 ring-white">
                {itemCount}
              </span>
            </Button>
          )}
        </div>
      </motion.div>

      {/* ---------------------------------------------------------------- */}
      {/* Hero block — brand gradient, logo, restaurant name, tagline,     */}
      {/* table + hours info chips. Scrolls away with the page.            */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="relative overflow-hidden pb-5 pt-1 text-white"
        style={heroBgStyle}
      >
        {/* Decorative overlay — soft radial highlights + dotted texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 18%, rgba(255,255,255,0.28), transparent 38%), radial-gradient(circle at 88% 8%, rgba(255,255,255,0.18), transparent 42%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        />
        {/* Bottom fade into the page background for a smooth transition */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-white/0"
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-3xl px-4 pt-3">
          {/* Logo / initials avatar */}
          <div className="flex items-start gap-3.5">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-2 ring-white/40"
            >
              {restaurant.logo ? (
                <img
                  src={restaurant.logo}
                  alt={restaurant.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span
                  className="text-[22px] font-black tracking-tight"
                  style={{ color: primary }}
                >
                  {initials || <UtensilsCrossed className="h-7 w-7" style={{ color: primary }} />}
                </span>
              )}
            </motion.div>

            <div className="min-w-0 flex-1 pt-0.5">
              <motion.h1
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05 }}
                className="truncate text-[22px] font-extrabold leading-tight tracking-tight drop-shadow-sm sm:text-[26px]"
              >
                {restaurant.name}
              </motion.h1>

              {restaurant.tagline && (
                <motion.p
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="mt-0.5 line-clamp-1 text-[13px] font-medium text-white/85"
                >
                  {restaurant.tagline}
                </motion.p>
              )}

              <motion.div
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="mt-2 flex flex-wrap items-center gap-1.5"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm ring-1 ring-white/25">
                  <MapPin className="h-3 w-3" />
                  Table {table.number}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm ring-1 ring-white/25">
                  <Clock className="h-3 w-3" />
                  {restaurant.openingTime}–{restaurant.closingTime}
                </span>
                {restaurant.isOpen && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/30 px-2 py-1 text-[11px] font-bold text-white ring-1 ring-emerald-100/40 backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-200" />
                    Open now
                  </span>
                )}
                {restaurant.description && (
                  <span className="hidden items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm ring-1 ring-white/25 sm:inline-flex">
                    <Star className="h-3 w-3" />
                    Dine-in
                  </span>
                )}
              </motion.div>
            </div>
          </div>

          {/* Optional description block */}
          {restaurant.description && (
            <motion.p
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-white/85"
            >
              {restaurant.description}
            </motion.p>
          )}
        </div>
      </div>
    </header>
  )
}
