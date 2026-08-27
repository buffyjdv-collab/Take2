'use client'

import { useState } from 'react'
import { useCustomerOrder, api } from '@/hooks/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/restaurant/loading-states'
import { Price, formatINR } from '@/components/restaurant/price'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
import { CheckCircle2, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import type { RestaurantInfo } from './types'
import { CheckoutSheet } from './checkout-sheet'

export function BillView({
  orderId,
  restaurant,
  onBackToMenu,
}: {
  orderId: string
  restaurant: RestaurantInfo
  onBackToMenu: () => void
}) {
  const qc = useQueryClient()
  const { data: order, isLoading } = useCustomerOrder(orderId)
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  if (isLoading || !order) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const invoice = order.invoices?.[0]
  const isPaid = order.paymentStatus === 'PAID'

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Invoice card */}
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <Card className="overflow-hidden">
          <div
            className="h-2"
            style={{ backgroundColor: restaurant.primaryColor }}
          />
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg">{restaurant.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {restaurant.address}
                </p>
                <p className="text-xs text-muted-foreground">
                  {restaurant.phone}
                  {restaurant.email ? ` • ${restaurant.email}` : ''}
                </p>
              </div>
              <PaymentStatusBadge status={order.paymentStatus} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center justify-between border-b border-dashed pb-2 text-xs">
              <div>
                <p>
                  <span className="text-muted-foreground">Bill #</span>{' '}
                  <span className="font-semibold">
                    {invoice?.invoiceNumber || order.orderNumber}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Order #</span>{' '}
                  {order.orderNumber}
                </p>
              </div>
              <div className="text-right">
                <p>
                  <span className="text-muted-foreground">Table</span>{' '}
                  <span className="font-semibold">{order.table?.number}</span>
                </p>
                <p className="text-muted-foreground">
                  {new Date(order.placedAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-1 text-sm">
              {order.items?.map((it: any) => (
                <div key={it.id} className="flex gap-2">
                  <span className="w-6 font-medium">{it.quantity}×</span>
                  <div className="flex-1">
                    <p>{it.menuItemName}</p>
                    {it.variantName && (
                      <p className="text-xs text-muted-foreground">
                        {it.variantName}
                      </p>
                    )}
                    {it.modifiers?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        + {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                      </p>
                    )}
                  </div>
                  <span className="font-medium">{formatINR(it.totalPrice)}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-4 space-y-1 border-t border-dashed pt-3 text-sm">
              <Row label="Subtotal" value={order.subtotal} />
              {order.taxAmount > 0 && <Row label="Taxes & GST" value={order.taxAmount} />}
              {order.serviceCharge > 0 && (
                <Row label="Service charge" value={order.serviceCharge} />
              )}
              <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
                <span>Grand total</span>
                <Price amount={order.grandTotal} size="xl" />
              </div>
            </div>

            {/* GST info */}
            {restaurant.gstNumber && (
              <p className="mt-3 text-[10px] text-muted-foreground">
                GSTIN: {restaurant.gstNumber} · PAN: {restaurant.panNumber || '—'}
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Payment options */}
      <div className="mt-5">
        {isPaid ? (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-lg font-bold text-green-700">Payment received</p>
              <p className="text-sm text-muted-foreground">
                Your order is now complete. Thank you for dining with {restaurant.name}!
              </p>
              <Button onClick={onBackToMenu} className="mt-2">
                Place another order
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Settle your bill
            </h2>
            {/* Zepto-style summary card + sticky "Pay ₹X" CTA */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-[13px] font-medium text-slate-600">Amount due</span>
                <span className="text-xl font-extrabold text-slate-900">{formatINR(order.grandTotal)}</span>
              </div>
              <div className="p-4">
                <Button
                  size="lg"
                  className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99]"
                  onClick={() => setCheckoutOpen(true)}
                  disabled={!restaurant.paymentMethods || restaurant.paymentMethods.length === 0}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay {formatINR(order.grandTotal)}
                </Button>
                {(!restaurant.paymentMethods || restaurant.paymentMethods.length === 0) && (
                  <p className="mt-3 text-center text-xs text-amber-600">
                    No payment methods configured. Please ask the staff.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Zepto-style Checkout Sheet (existing-order mode) */}
      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        restaurant={restaurant}
        totals={{
          itemCount: order.items?.length || 0,
          subtotal: order.subtotal,
          taxAmount: order.taxAmount,
          serviceCharge: order.serviceCharge,
          grandTotal: order.grandTotal,
        }}
        items={[]}
        existingOrderId={order.id}
        skipCustomerDetails
        onCheckoutComplete={() => {
          setCheckoutOpen(false)
          qc.invalidateQueries({ queryKey: ['customer-order', orderId] })
        }}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-slate-700">{formatINR(value)}</span>
    </div>
  )
}
