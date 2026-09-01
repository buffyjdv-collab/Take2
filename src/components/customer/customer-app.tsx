'use client'

import { useEffect, useState } from 'react'
import { useCustomerMenu, api } from '@/hooks/api'
import { useCustomerCart } from '@/stores/customer-cart'
import { RestaurantHeader } from './restaurant-header'
import { CategoryTabs } from './category-tabs'
import { MenuList } from './menu-list'
import { ItemDetailSheet } from './item-detail-sheet'
import { CartDrawer } from './cart-drawer'
import { OrderTracking } from './order-tracking'
import { BillView } from './bill-view'
import { FloatingCartButton } from './floating-cart-button'
import { CustomerBottomNav } from './customer-bottom-nav'
import { Button } from '@/components/ui/button'
import { Clock, Utensils, ChevronRight, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import type { MenuItemWithRelations } from './types'

export type View = 'menu' | 'cart' | 'checkout' | 'track' | 'bill'

export function CustomerApp({ token }: { token: string }) {
  const [view, setView] = useState<View>('menu')
  const [activeCategoryId, setActiveCategoryId] = useState<string>('')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  const [justPlaced, setJustPlaced] = useState(false)
  // Customer name & mobile captured when the customer taps "Order more items"
  // on a previously accepted order. The next checkout pre-fills these so the
  // follow-up order is placed as a fresh new order with the same details.
  const [prefillCustomer, setPrefillCustomer] = useState<{ name: string; phone: string } | null>(null)

  useEffect(() => {
    const saved = sessionStorage.getItem(`order-${token}`)
    if (saved) setPlacedOrderId(saved)

    const returningFromUpi = sessionStorage.getItem('returning-from-upi')
    if (returningFromUpi && saved) {
      sessionStorage.removeItem('returning-from-upi')
      window.location.hash = 'track'
    }

    // Restore any pre-fill customer details captured when the customer tapped
    // "Order more items" on a previously accepted order (survives a reload).
    const prefill = sessionStorage.getItem(`prefill-customer-${token}`)
    if (prefill) {
      try {
        setPrefillCustomer(JSON.parse(prefill))
      } catch {
        sessionStorage.removeItem(`prefill-customer-${token}`)
      }
    }
  }, [token])

  const { data, isLoading, error } = useCustomerMenu(token)
  const setScope = useCustomerCart((s) => s.setScope)
  const clearCart = useCustomerCart((s) => s.clear)

  useEffect(() => {
    if (data?.restaurant.id && data?.table.id) {
      setScope(data.restaurant.id, data.table.id)
    }
  }, [data?.restaurant.id, data?.table.id, setScope])

  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace('#', '')
      if (['track', 'bill'].includes(h)) {
        setView(h as View)
      } else {
        setView('menu')
      }
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  useEffect(() => {
    if (justPlaced && placedOrderId) {
      window.location.hash = 'track'
      setJustPlaced(false)
    }
  }, [justPlaced, placedOrderId])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-orange-500" />
          <p className="mt-3 text-sm text-slate-400">Loading menu…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center">
        <div className="rounded-2xl bg-red-50 p-4">
          <Utensils className="h-8 w-8 text-red-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">QR code invalid</h1>
          <p className="mt-1 text-sm text-slate-400">
            {error.message || 'This QR code is not recognised.'}
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (!data) return null

  const { restaurant, table, categories, items } = data

  if (!restaurant.isOpen) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6 text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md space-y-4"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50">
            <Clock className="h-10 w-10 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">{restaurant.name} is currently closed</h1>
            <p className="mt-2 text-sm text-slate-400">
              We&apos;re sorry — we aren&apos;t taking orders right now. We&apos;re open
              daily {restaurant.openingTime} – {restaurant.closingTime}.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left text-sm">
            <p className="font-semibold text-slate-800">{restaurant.name}</p>
            <p className="text-slate-400">{restaurant.address}</p>
            <p className="text-slate-400">{restaurant.phone}</p>
          </div>
        </motion.div>
      </div>
    )
  }

  const activeItem: MenuItemWithRelations | undefined = activeItemId
    ? items.find((i: any) => i.id === activeItemId)
    : undefined

  return (
    <div className="min-h-screen bg-white">
      <RestaurantHeader
        restaurant={restaurant}
        table={table}
        onBackToMenu={() => {
          setView('menu')
          window.location.hash = ''
        }}
      />

      {view === 'menu' && (
        <>
          <CategoryTabs
            categories={categories}
            activeId={activeCategoryId}
            onChange={setActiveCategoryId}
          />
          <MenuList
            categories={categories}
            items={items}
            activeCategoryId={activeCategoryId}
            onActiveCategoryChange={setActiveCategoryId}
            onSelectItem={(id) => setActiveItemId(id)}
          />
        </>
      )}

      {view === 'track' && !placedOrderId && (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="text-sm text-slate-400">No active order to track.</p>
        </div>
      )}

      {view === 'track' && placedOrderId && (
        <OrderTracking
          orderId={placedOrderId}
          restaurant={restaurant}
          onBackToMenu={() => {
            setView('menu')
            window.location.hash = ''
          }}
          onProceedToBill={() => {
            setView('bill')
            window.location.hash = 'bill'
          }}
          onOrderMore={(name, phone) => {
            // Start a FRESH new order: clear the cart so the customer builds a
            // new one, but re-use the customer's name & mobile from the
            // accepted order (pre-filled in the checkout details step).
            clearCart()
            const prefill = { name: name || '', phone: phone || '' }
            setPrefillCustomer(prefill)
            sessionStorage.setItem(`prefill-customer-${token}`, JSON.stringify(prefill))
            setView('menu')
            window.location.hash = ''
            toast.info('Start a new order — your details are saved.', {
              description: 'Add items, then checkout. It will go through as a new order.',
            })
          }}
        />
      )}

      {view === 'bill' && placedOrderId && (
        <BillView
          orderId={placedOrderId}
          restaurant={restaurant}
          onBackToMenu={() => {
            sessionStorage.removeItem(`order-${token}`)
            setPlacedOrderId(null)
            setView('menu')
            window.location.hash = ''
          }}
        />
      )}

      <ItemDetailSheet
        item={activeItem || null}
        open={!!activeItem}
        onOpenChange={(o) => !o && setActiveItemId(null)}
        currencySymbol={restaurant.currencySymbol}
      />

      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        restaurant={restaurant}
        initialCustomerName={prefillCustomer?.name}
        initialCustomerPhone={prefillCustomer?.phone}
        onCheckout={(orderId) => {
          setPlacedOrderId(orderId)
          setJustPlaced(true)
          sessionStorage.setItem(`order-${token}`, orderId)
          // The new order is placed — clear the pre-fill so it isn't reused
          // for an unrelated future order.
          setPrefillCustomer(null)
          sessionStorage.removeItem(`prefill-customer-${token}`)
          setCartOpen(false)
          toast.success('Order placed! Track its status below.')
        }}
      />

      {placedOrderId && view === 'menu' && (
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => {
            window.location.hash = 'track'
          }}
          className="fixed bottom-36 right-4 z-30 flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-orange-600 shadow-lg ring-1 ring-orange-100 transition-all hover:bg-orange-50 hover:shadow-xl active:scale-95 md:hidden"
        >
          Track order
          <ChevronRight className="h-4 w-4" />
        </motion.button>
      )}

      <FloatingCartButton onClick={() => setCartOpen(true)} />

      {/* Mobile bottom tab bar — hidden on md+ where the top header + scroll menu suffice. */}
      <CustomerBottomNav
        view={view}
        hasOrder={!!placedOrderId}
        onNavigate={(v) => {
          if (v === 'menu') {
            setView('menu')
            window.location.hash = ''
          } else if (v === 'track') {
            if (placedOrderId) {
              setView('track')
              window.location.hash = 'track'
            }
          } else if (v === 'bill') {
            if (placedOrderId) {
              setView('bill')
              window.location.hash = 'bill'
            }
          }
        }}
      />
    </div>
  )
}

export { api }
