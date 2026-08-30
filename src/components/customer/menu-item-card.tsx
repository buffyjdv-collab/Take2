'use client'

import { Plus, Minus, Flame, Star } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { VegBadge } from '@/components/restaurant/veg-badge'
import { Price, formatINR } from '@/components/restaurant/price'
import { cn } from '@/lib/utils'
import type { MenuItemWithRelations } from './types'
import { useCustomerCart, lineKeyOf } from '@/stores/customer-cart'

/**
 * useItemCartState
 * Shared helper that resolves the cart state + quick-add / inc / dec handlers
 * for a single menu item. Used by both `MenuSection` (full-width row) and
 * `MenuItemCardCompact` (swipeable carousel card) so behaviour stays in sync.
 */
function useItemCartState(item: MenuItemWithRelations, onSelect: () => void) {
  const items = useCustomerCart((s) => s.items)
  const addItem = useCustomerCart((s) => s.addItem)
  const updateQuantity = useCustomerCart((s) => s.updateQuantity)

  const matchingLines = items.filter((i) => i.menuItemId === item.id)
  const inCartQty = matchingLines.reduce((n, i) => n + i.quantity, 0)

  const variantFrom = item.variants.length
    ? Math.min(...item.variants.map((v) => item.basePrice + v.priceModifier))
    : item.basePrice

  const hasRequiredModifiers = item.modifierGroups.some((g) => g.required)
  const hasVariants = item.variants.length > 0

  const quickAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasVariants || hasRequiredModifiers) {
      onSelect()
      return
    }
    const defaultVariant = item.variants.find((v) => v.isDefault) || null
    const cartItem = {
      menuItemId: item.id,
      name: item.name,
      image: item.image,
      basePrice: item.basePrice,
      variantId: defaultVariant?.id,
      variantName: defaultVariant?.name,
      variantPrice: defaultVariant?.priceModifier || 0,
      modifierIds: [],
      modifierNames: [],
      modifiersTotal: 0,
      quantity: 1,
      isVeg: item.isVeg,
      unitPrice: item.basePrice + (defaultVariant?.priceModifier || 0),
      totalPrice: item.basePrice + (defaultVariant?.priceModifier || 0),
    }
    addItem(cartItem)
  }

  const quickInc = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (matchingLines.length === 0) return
    const first = matchingLines[0]
    updateQuantity(lineKeyOf(first), first.quantity + 1)
  }

  const quickDec = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (matchingLines.length === 0) return
    const first = matchingLines[0]
    updateQuantity(lineKeyOf(first), first.quantity - 1)
  }

  return {
    inCartQty,
    variantFrom,
    hasVariants,
    hasRequiredModifiers,
    quickAdd,
    quickInc,
    quickDec,
  }
}

export function MenuSection({
  item,
  onSelect,
}: {
  item: MenuItemWithRelations
  onSelect: () => void
}) {
  const { inCartQty, variantFrom, quickAdd, quickInc, quickDec } =
    useItemCartState(item, onSelect)

  return (
    <div
      role="button"
      tabIndex={item.soldOut ? -1 : 0}
      onClick={item.soldOut ? undefined : onSelect}
      onKeyDown={(e) => {
        if (item.soldOut) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group relative flex w-full items-start gap-3 pb-5 text-left transition-all',
        'border-b border-slate-100 last:border-0',
        item.soldOut && 'pointer-events-none opacity-50',
      )}
    >
      {/* Left content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-center gap-1.5">
          <VegBadge isVeg={item.isVeg} />
          {item.isPopular && (
            <span className="inline-flex items-center gap-1 rounded bg-yellow-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-yellow-800">
              <span className="text-yellow-500">★</span> Popular
            </span>
          )}
          {item.isSpicy && (
            <span className="inline-flex items-center text-red-500" title="Spicy">
              <Flame className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <h3 className="text-[15px] font-semibold leading-tight text-slate-900">
          {item.name}
        </h3>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-slate-500">
            {item.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2.5">
          <Price amount={variantFrom} size="sm" className="text-slate-900" />
          {item.variants.length > 0 && (
            <span className="text-[11px] text-slate-400">
              {item.variants.length} sizes
            </span>
          )}
        </div>
      </div>

      {/* Right: image + add/counter button */}
      <div className="relative shrink-0 pt-0.5">
        <div className="h-[130px] w-[130px] overflow-hidden rounded-2xl bg-slate-50">
          {item.image ? (
            <img
              src={item.image}
              alt={item.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 text-4xl">
              🍽️
            </div>
          )}
        </div>

        {/* ADD / counter button — positioned at the bottom of the image */}
        {item.soldOut ? (
          <span className="absolute bottom-[-10px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase text-slate-500">
            Sold out
          </span>
        ) : (
          <div className="absolute bottom-[-10px] left-1/2 -translate-x-1/2">
            <AnimatePresence mode="popLayout" initial={false}>
              {inCartQty === 0 ? (
                <motion.button
                  key="add"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  onClick={quickAdd}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:border-orange-400 hover:text-orange-600 hover:shadow-md"
                  aria-label={`Add ${item.name} to cart`}
                >
                  <Plus className="h-4.5 w-4.5" strokeWidth={2.5} />
                </motion.button>
              ) : (
                <motion.div
                  key="counter"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="flex h-9 items-center overflow-hidden rounded-xl border-2 border-orange-400 bg-white shadow-md"
                >
                  <button
                    onClick={quickDec}
                    className="flex h-9 w-9 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
                    aria-label={`Remove one ${item.name}`}
                  >
                    <Minus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <motion.span
                    key={inCartQty}
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                    className="min-w-5 px-0.5 text-center text-sm font-extrabold text-orange-600"
                  >
                    {inCartQty}
                  </motion.span>
                  <button
                    onClick={quickInc}
                    className="flex h-9 w-9 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
                    aria-label={`Add one more ${item.name}`}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * MenuItemCardCompact
 * Vertical card designed for the horizontal swipeable carousel layout used on
 * the QR menu. Each card is ~170px wide (the parent grid column controls the
 * exact width) and stacks image -> name -> price -> ADD/qty button vertically
 * so two cards fit comfortably in a single mobile viewport.
 */
export function MenuItemCardCompact({
  item,
  onSelect,
}: {
  item: MenuItemWithRelations
  onSelect: () => void
}) {
  const {
    inCartQty,
    variantFrom,
    hasVariants,
    quickAdd,
    quickInc,
    quickDec,
  } = useItemCartState(item, onSelect)

  return (
    <div
      role="button"
      tabIndex={item.soldOut ? -1 : 0}
      onClick={item.soldOut ? undefined : onSelect}
      onKeyDown={(e) => {
        if (item.soldOut) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{ scrollSnapAlign: 'start' }}
      className={cn(
        'group flex w-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70 transition-all',
        'hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300',
        item.soldOut && 'pointer-events-none opacity-55',
      )}
    >
      {/* Image */}
      <div className="relative aspect-[5/4] w-full overflow-hidden bg-slate-50">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50 text-4xl">
            🍽️
          </div>
        )}

        {/* Top-left badges */}
        <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
          <span className="rounded-md bg-white/95 p-0.5 shadow-sm backdrop-blur-sm">
            <VegBadge isVeg={item.isVeg} />
          </span>
          {item.isPopular && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-yellow-400/95 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-900 shadow-sm">
              <Star className="h-2.5 w-2.5 fill-yellow-900" />
              Popular
            </span>
          )}
          {item.isSpicy && (
            <span className="inline-flex items-center justify-center rounded-md bg-white/95 p-1 text-red-500 shadow-sm">
              <Flame className="h-3 w-3" />
            </span>
          )}
        </div>

        {/* Sold-out overlay */}
        {item.soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[1px]">
            <span className="rounded-md bg-slate-900/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
              Sold out
            </span>
          </div>
        )}

        {/* Quick-add circular button — overlaps the bottom-right of the image */}
        {!item.soldOut && inCartQty === 0 && (
          <motion.button
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onClick={quickAdd}
            className="absolute bottom-1.5 right-1.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-700 shadow-md transition-all hover:border-orange-400 hover:text-orange-600 hover:shadow-lg active:scale-95"
            aria-label={`Add ${item.name} to cart`}
          >
            <Plus className="h-4.5 w-4.5" strokeWidth={2.5} />
          </motion.button>
        )}

        {/* Qty counter — also overlaps bottom-right when item is in cart */}
        {!item.soldOut && inCartQty > 0 && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="absolute bottom-1.5 right-1.5 flex h-9 items-center overflow-hidden rounded-full border-2 border-orange-400 bg-white shadow-md"
          >
            <button
              onClick={quickDec}
              className="flex h-9 w-9 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
              aria-label={`Remove one ${item.name}`}
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <motion.span
              key={inCartQty}
              initial={{ scale: 1.4 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 20 }}
              className="min-w-5 px-0.5 text-center text-[13px] font-extrabold text-orange-600"
            >
              {inCartQty}
            </motion.span>
            <button
              onClick={quickInc}
              className="flex h-9 w-9 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
              aria-label={`Add one more ${item.name}`}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </motion.div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 px-2.5 pb-2.5 pt-2">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
          {item.name}
        </h3>
        <div className="mt-auto flex items-baseline gap-1.5">
          <Price amount={variantFrom} size="sm" className="text-slate-900" />
          {hasVariants && (
            <span className="text-[10px] text-slate-400">· sizes</span>
          )}
        </div>
      </div>
    </div>
  )
}

export { formatINR }
