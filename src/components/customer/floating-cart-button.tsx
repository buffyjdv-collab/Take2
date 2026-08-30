'use client'

import { ShoppingBag } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCustomerCart } from '@/stores/customer-cart'
import { useCustomerMenu } from '@/hooks/api'

export function FloatingCartButton({ onClick }: { onClick: () => void }) {
  const items = useCustomerCart((s) => s.items)
  const totals = useCustomerCart((s) => s.totals)
  const table = new URLSearchParams(window.location.search).get('table')
  const { data } = useCustomerMenu(table)
  const r = data?.restaurant
  const t = r ? totals(r.taxRate, r.serviceChargeRate) : null

  if (items.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        // On mobile the customer bottom nav (h-14 = 56px) occupies the
        // bottom of the screen, so this button is pushed up by 56px +
        // safe-area. On md+ there's no bottom nav, so it stays at bottom-0.
        className="fixed inset-x-0 bottom-14 z-30 md:bottom-0"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Gradient overlay above the bar */}
        <div className="h-6 bg-gradient-to-t from-black/10 to-transparent" />
        <button
          onClick={onClick}
          className="flex w-full items-center justify-between bg-orange-600 px-5 py-4 text-white shadow-2xl shadow-orange-600/30 transition-all active:scale-[0.995] sm:rounded-t-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <ShoppingBag className="h-5 w-5" />
              <motion.span
                key={t?.itemCount || 0}
                initial={{ scale: 1.5, y: -2 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                className="absolute -right-2.5 -top-2.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold leading-none text-orange-700"
              >
                {t?.itemCount || 0}
              </motion.span>
            </div>
            <span className="text-[15px] font-bold">
              {t?.itemCount === 1 ? `${t?.itemCount} ITEM` : `${t?.itemCount} ITEMS`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-extrabold">₹{(t?.grandTotal || 0).toFixed(0)}</span>
            <svg
              className="h-5 w-5 opacity-80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
