'use client'

import { ArrowLeft, Search, ShoppingBag, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import type { RestaurantInfo, TableInfo } from './types'
import { useCustomerCart } from '@/stores/customer-cart'
import { cn } from '@/lib/utils'

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

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className={cn(
        'sticky top-0 z-30 bg-white',
        // Show subtle bottom border only when scrolled (via group-hover or a
        // class toggle). For simplicity we always show a very faint border.
        'shadow-[0_1px_0_0_rgba(0,0,0,0.06)]',
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        {/* Back button — shown on track/bill views */}
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1.5 h-9 w-9 shrink-0 rounded-full hover:bg-slate-100"
          onClick={onBackToMenu}
          aria-label="Back to menu"
        >
          <ArrowLeft className="h-5 w-5 text-slate-700" />
        </Button>

        {/* Restaurant info — clickable to go back to menu on track/bill views */}
        <div className="min-w-0 flex-1" onClick={onBackToMenu} role="button">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[15px] font-bold text-slate-900">
              {restaurant.name}
            </h1>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="font-medium text-slate-700">Table {table.number}</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>Dine-in</span>
            {restaurant.tagline && (
              <>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="truncate">{restaurant.tagline}</span>
              </>
            )}
          </div>
        </div>

        {/* Search button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full hover:bg-slate-100"
          aria-label="Search menu"
        >
          <Search className="h-[18px] w-[18px] text-slate-600" />
        </Button>

        {/* Cart icon with badge */}
        {itemCount > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 shrink-0 rounded-full hover:bg-slate-100"
            aria-label="Cart"
          >
            <ShoppingBag className="h-[18px] w-[18px] text-slate-600" />
            <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-white">
              {itemCount}
            </span>
          </Button>
        )}
      </div>
    </motion.header>
  )
}
