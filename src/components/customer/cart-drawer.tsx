'use client'

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Minus, Plus, Trash2, ShoppingBag, ChevronRight } from 'lucide-react'
import { useCustomerCart, lineKeyOf } from '@/stores/customer-cart'
import { Price } from '@/components/restaurant/price'
import { VegBadge } from '@/components/restaurant/veg-badge'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/restaurant/loading-states'
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { RestaurantInfo } from './types'
import type { CartItem } from '@/lib/types'
import { CheckoutSheet } from './checkout-sheet'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurant: RestaurantInfo
  onCheckout: (orderId: string, customerPhone?: string) => void
  /** Pre-fill customer name/phone on the checkout details step (used when the
   *  customer is placing a fresh follow-up order after a previous accepted
   *  order — same name & mobile). */
  initialCustomerName?: string
  initialCustomerPhone?: string
}

export function CartDrawer({ open, onOpenChange, restaurant, onCheckout, initialCustomerName, initialCustomerPhone }: Props) {
  const items = useCustomerCart((s) => s.items)
  const updateQuantity = useCustomerCart((s) => s.updateQuantity)
  const removeItem = useCustomerCart((s) => s.removeItem)
  const clear = useCustomerCart((s) => s.clear)
  const totals = useCustomerCart((s) => s.totals)

  const [checkoutOpen, setCheckoutOpen] = useState(false)

  const t = totals(restaurant.taxRate, restaurant.serviceChargeRate)

  const handleCheckoutComplete = (orderId: string, customerPhone?: string) => {
    setCheckoutOpen(false)
    clear()
    onCheckout(orderId, customerPhone)
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh] rounded-t-3xl">
          {/* Custom drag handle — Swiggy style thick bar */}
          <div className="mx-auto mb-0 mt-2 h-1 w-10 rounded-full bg-slate-300" />
          <DrawerHeader className="border-b border-slate-100 pb-3">
            <DrawerTitle className="flex items-center gap-2.5 text-left">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
                <ShoppingBag className="h-4.5 w-4.5 text-orange-600" />
              </div>
              <div>
                <span className="text-base font-bold text-slate-900">
                  Your order
                </span>
                {items.length > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-slate-400">
                    ({t.itemCount} item{t.itemCount !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
            </DrawerTitle>
          </DrawerHeader>

          {items.length === 0 ? (
            <div className="px-4 py-10">
              <EmptyState
                icon={<ShoppingBag className="h-6 w-6" />}
                title="Your cart is empty"
                description="Add some dishes from the menu to get started."
              />
            </div>
          ) : (
            <>
              {/* Cart items — Swiggy style: compact list */}
              <div className="max-h-[38vh] divide-y divide-slate-100 overflow-y-auto px-4 py-1">
                {items.map((item) => {
                  const key = lineKeyOf(item)
                  return (
                    <motion.div
                      key={key}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-3 py-3"
                    >
                      <VegBadge isVeg={item.isVeg} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-slate-800">
                          {item.name}
                        </p>
                        {item.variantName && (
                          <p className="text-[11px] text-slate-400">{item.variantName}</p>
                        )}
                        {item.modifierNames.length > 0 && (
                          <p className="truncate text-[11px] text-slate-400">
                            {item.modifierNames.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="min-w-[50px] text-right text-sm font-semibold text-slate-800">
                          ₹{item.totalPrice.toFixed(0)}
                        </span>
                        {/* Quantity controls — compact inline */}
                        <div className="flex items-center rounded-lg border border-slate-200">
                          <button
                            onClick={() => updateQuantity(key, item.quantity - 1)}
                            className="flex h-7 w-7 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
                            aria-label="Decrease"
                          >
                            {item.quantity === 1 ? (
                              <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
                            ) : (
                              <Minus className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <span className="w-6 text-center text-sm font-bold text-slate-800">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(key, item.quantity + 1)}
                            className="flex h-7 w-7 items-center justify-center text-orange-500 transition-colors hover:bg-orange-50"
                            aria-label="Increase"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {/* Bill details — Swiggy style */}
              <div className="border-t border-slate-100 bg-white px-4 py-3">
                <button
                  className="flex w-full items-center justify-between py-1 text-left"
                  onClick={() => {}}
                >
                  <span className="text-[13px] font-bold text-slate-700">
                    Bill Details
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
                <div className="mt-1 space-y-1.5 text-[13px]">
                  <div className="flex justify-between text-slate-500">
                    <span>Item total</span>
                    <span>₹{t.subtotal.toFixed(0)}</span>
                  </div>
                  {restaurant.taxRate > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Taxes & GST ({(restaurant.taxRate * 100).toFixed(1)}%)</span>
                      <span>₹{t.taxAmount.toFixed(0)}</span>
                    </div>
                  )}
                  {restaurant.serviceChargeRate > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Service charge ({(restaurant.serviceChargeRate * 100).toFixed(0)}%)</span>
                      <span>₹{t.serviceCharge.toFixed(0)}</span>
                    </div>
                  )}
                </div>
                <Separator className="my-2.5" />
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-extrabold text-slate-900">TO PAY</span>
                  <span className="text-lg font-extrabold text-slate-900">₹{t.grandTotal.toFixed(0)}</span>
                </div>
              </div>
            </>
          )}

          {items.length > 0 && (
            <DrawerFooter className="border-t-0 bg-white px-4 pt-1 pb-6">
              <Button
                size="lg"
                className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 hover:shadow-orange-600/35 active:scale-[0.99]"
                onClick={() => setCheckoutOpen(true)}
              >
                Proceed to pay · ₹{t.grandTotal.toFixed(0)}
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>

      {/* Zepto-style checkout sheet — replaces the old inline checkout Dialog */}
      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        restaurant={restaurant}
        totals={{
          itemCount: t.itemCount,
          subtotal: t.subtotal,
          taxAmount: t.taxAmount,
          serviceCharge: t.serviceCharge,
          grandTotal: t.grandTotal,
        }}
        items={items as CartItem[]}
        onCheckoutComplete={handleCheckoutComplete}
        initialCustomerName={initialCustomerName}
        initialCustomerPhone={initialCustomerPhone}
      />
    </>
  )
}
