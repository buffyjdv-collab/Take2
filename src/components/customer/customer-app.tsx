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
import { LoadingSpinner } from '@/components/restaurant/loading-states'
import { Button } from '@/components/ui/button'
import { ChefHat, Clock, Utensils } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import type { MenuItemWithRelations } from './types'

type View = 'menu' | 'cart' | 'checkout' | 'track' | 'bill'

export function CustomerApp({ token }: { token: string }) {
  const [view, setView] = useState<View>('menu')
  const [activeCategoryId, setActiveCategoryId] = useState<string>('')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  // Tracks whether we just placed an order (one-shot). The hash-routing
  // auto-redirect to #track should fire ONLY immediately after placement —
  // not on every visit where a placedOrderId exists in sessionStorage.
  // Without this guard, scanning a QR code for a table where a previous order
  // exists locks the customer into the track view and they can never reach
  // the menu (because the "Back to menu" button doesn't clear placedOrderId).
  const [justPlaced, setJustPlaced] = useState(false)

  // Restore placed order from sessionStorage (so customer refresh keeps tracking)
  // NOTE: this is for tracking convenience — it does NOT force navigation.
  // The customer always lands on the menu view by default; they can opt to
  // view an existing order's tracking page via the "Track order" button.
  // Exception: if the customer is returning from a UPI payment redirect,
  // auto-navigate to the tracking view.
  useEffect(() => {
    const saved = sessionStorage.getItem(`order-${token}`)
    if (saved) setPlacedOrderId(saved)

    // Auto-navigate to tracking if returning from UPI payment
    const returningFromUpi = sessionStorage.getItem('returning-from-upi')
    if (returningFromUpi && saved) {
      sessionStorage.removeItem('returning-from-upi')
      window.location.hash = 'track'
    }
  }, [token])

  const { data, isLoading, error } = useCustomerMenu(token)
  const setScope = useCustomerCart((s) => s.setScope)

  useEffect(() => {
    if (data?.restaurant.id && data?.table.id) {
      setScope(data.restaurant.id, data.table.id)
    }
  }, [data?.restaurant.id, data?.table.id, setScope])

  // Hash-based view routing — the URL hash is the single source of truth.
  // Empty hash → menu view. This means a fresh QR scan always opens the menu.
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

  // One-shot: after the customer places an order, jump to the tracking view.
  // We clear the `justPlaced` flag immediately so a later "Back to menu"
  // click is not overridden.
  useEffect(() => {
    if (justPlaced && placedOrderId) {
      window.location.hash = 'track'
      setJustPlaced(false)
    }
  }, [justPlaced, placedOrderId])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-orange-50/30">
        <div className="text-center">
          <LoadingSpinner size="lg" className="text-orange-600" />
          <p className="mt-3 text-sm text-muted-foreground">
            Loading menu…
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-orange-50/30 p-6 text-center">
        <div className="rounded-full bg-red-100 p-4">
          <Utensils className="h-8 w-8 text-red-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold">QR code invalid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error.message || 'This QR code is not recognised.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!data) return null

  const { restaurant, table, categories, items } = data

  if (!restaurant.isOpen) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-orange-50/30 p-6 text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md space-y-4"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-10 w-10 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{restaurant.name} is currently closed</h1>
            <p className="mt-1 text-muted-foreground">
              We're sorry — we aren't taking orders right now. We're open
              daily {restaurant.openingTime} – {restaurant.closingTime}.
            </p>
          </div>
          <div className="rounded-lg border bg-white p-4 text-left text-sm">
            <p className="font-semibold">{restaurant.name}</p>
            <p className="text-muted-foreground">{restaurant.address}</p>
            <p className="text-muted-foreground">{restaurant.phone}</p>
          </div>
        </motion.div>
      </div>
    )
  }

  const activeItem: MenuItemWithRelations | undefined = activeItemId
    ? items.find((i: any) => i.id === activeItemId)
    : undefined

  return (
    <div
      className="min-h-screen bg-white"
      style={{
        // Apply restaurant brand colours as CSS vars
        ['--brand-primary' as any]: restaurant.primaryColor,
        ['--brand-accent' as any]: restaurant.accentColor,
      }}
    >
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
          <p className="text-sm text-muted-foreground">No active order to track.</p>
        </div>
      )}

      {view === 'track' && placedOrderId && (
        <OrderTracking
          orderId={placedOrderId}
          restaurant={restaurant}
          onBackToMenu={() => {
            // "Back to menu" — go to menu view and clear the hash so a refresh
            // doesn't drop the customer back into track. We deliberately do
            // NOT clear placedOrderId here: the customer may want to return to
            // the tracking view via the floating "Track order" button.
            setView('menu')
            window.location.hash = ''
          }}
          onProceedToBill={() => {
            setView('bill')
            window.location.hash = 'bill'
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
        onCheckout={(orderId) => {
          setPlacedOrderId(orderId)
          setJustPlaced(true)
          sessionStorage.setItem(`order-${token}`, orderId)
          setCartOpen(false)
          toast.success('Order placed! Track its status below.')
        }}
      />

      {/* When the customer has an existing order but is browsing the menu,
          show a small "Track order" button so they can return to tracking. */}
      {placedOrderId && view === 'menu' && (
        <button
          onClick={() => {
            window.location.hash = 'track'
          }}
          className="fixed bottom-4 right-4 z-30 rounded-full bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          Track order →
        </button>
      )}

      <FloatingCartButton onClick={() => setCartOpen(true)} />
    </div>
  )
}

// Re-export the api helper for child components needing direct mutation calls
export { api }
