'use client'

import { useState, useEffect } from 'react'
import { useCustomerOrder, useCancelOrder } from '@/hooks/api'
import { useSocketEvent } from '@/hooks/use-socket'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
import { LoadingSpinner, EmptyState } from '@/components/restaurant/loading-states'
import { formatINR } from '@/components/restaurant/price'
import { BellRing, CheckCircle2, Clock, ChefHat, PackageCheck, Utensils, XCircle, CreditCard, ArrowRight, Smartphone, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { VegBadge } from '@/components/restaurant/veg-badge'
import type { OrderStatus } from '@/lib/types'
import type { RestaurantInfo } from './types'
import { CheckoutSheet } from './checkout-sheet'

const STEPS: { key: OrderStatus; label: string; sublabel: string; icon: any }[] = [
  { key: 'NEW', label: 'Order Placed', sublabel: 'Waiting for restaurant to accept', icon: CheckCircle2 },
  { key: 'ACCEPTED', label: 'Confirmed', sublabel: 'Restaurant has accepted your order', icon: BellRing },
  { key: 'PREPARING', label: 'Preparing', sublabel: 'The chef is preparing your food', icon: ChefHat },
  { key: 'READY', label: 'Ready', sublabel: 'Your food is ready for serving', icon: PackageCheck },
  { key: 'SERVED', label: 'Served', sublabel: 'Enjoy your meal!', icon: Utensils },
]

function stepIndex(status: string): number {
  const order: string[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']
  const i = order.indexOf(status)
  if (i < 0) return -1
  return Math.min(i, STEPS.length - 1)
}

export function OrderTracking({
  orderId,
  restaurant,
  onBackToMenu,
  onProceedToBill,
}: {
  orderId: string
  restaurant?: RestaurantInfo
  onBackToMenu: () => void
  onProceedToBill: () => void
}) {
  const qc = useQueryClient()
  const { data: order, isLoading } = useCustomerOrder(orderId)
  const cancel = useCancelOrder()
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [postPayPrompted, setPostPayPrompted] = useState(false)

  useSocketEvent('order:updated', (payload: any) => {
    if (payload?.orderId === orderId) {
      qc.invalidateQueries({ queryKey: ['customer-order', orderId] })
    }
  })
  useSocketEvent('order:statusChanged', (payload: any) => {
    if (payload?.orderId === orderId) {
      qc.invalidateQueries({ queryKey: ['customer-order', orderId] })
      toast.success(`Order status: ${payload.status}`)
    }
  })
  useSocketEvent('payment:confirmed', (payload: any) => {
    if (payload?.orderId === orderId) {
      qc.invalidateQueries({ queryKey: ['customer-order', orderId] })
      toast.success('Payment confirmed!')
    }
  })
  useSocketEvent('payment:requested', (payload: any) => {
    if (payload?.orderId === orderId) {
      qc.invalidateQueries({ queryKey: ['customer-order', orderId] })
      const when = payload.when === 'PRE' ? 'before we accept your order' : 'now that your order is received'
      toast.info(`Payment requested: please pay ${when}.`, {
        description: `Amount: ₹${(payload.amount || 0).toFixed(0)}`,
      })
    }
  })

  if (isLoading || !order) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-3 text-sm text-slate-400">Loading your order…</p>
        </div>
      </div>
    )
  }

  const curStep = stepIndex(order.status)
  const canCancel = order.status === 'NEW' || order.status === 'PENDING_PAYMENT'
  const canRequestBill = ['SERVED', 'READY'].includes(order.status) && order.paymentStatus !== 'PAID'
  const isPaid = order.paymentStatus === 'PAID'
  const isCompleted = order.status === 'COMPLETED'
  const isPendingPayment = order.status === 'PENDING_PAYMENT'
  const isServed = order.status === 'SERVED'

  const needsToPay =
    !isPaid &&
    (isPendingPayment || order.prePaymentRequested || order.postPaymentRequested)

  // Auto-open the checkout sheet once when the order transitions to SERVED
  // and payment hasn't been collected yet (Zepto-style auto-prompt).
  useEffect(() => {
    if (
      isServed &&
      !isPaid &&
      !postPayPrompted &&
      !sessionStorage.getItem(`postpay-popup-${orderId}`)
    ) {
      setCheckoutOpen(true)
      sessionStorage.setItem(`postpay-popup-${orderId}`, 'shown')
      setPostPayPrompted(true)
    }
  }, [isServed, isPaid, orderId, postPayPrompted])

  // Estimate minutes remaining
  const estMinutes = (() => {
    if (curStep < 0 || isCompleted) return null
    if (curStep <= 1) return '~20-25 min'
    if (curStep === 2) return '~10-15 min'
    if (curStep === 3) return '~5 min'
    return null
  })()

  return (
    <div className="mx-auto max-w-3xl bg-white px-4 py-5">
      {/* Order header — Swiggy style */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="mb-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900">{order.orderNumber}</h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-400">
              <MapPin className="h-3.5 w-3.5" />
              <span>Table {order.table?.number} · Dine-in</span>
            </div>
          </div>
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </motion.div>

      {/* Animated status timeline — Swiggy style */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mb-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
      >
        {/* Current status banner */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            {estMinutes && (
              <p className="text-[13px] font-medium text-orange-600">
                {order.status === 'PREPARING' ? 'Estimated' : 'Expected in'}
              </p>
            )}
            <p className="text-2xl font-extrabold text-slate-900">
              {isCompleted
                ? 'Order Complete'
                : estMinutes || STEPS[Math.max(curStep, 0)]?.label || 'Processing'}
            </p>
          </div>
          {estMinutes && (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
              <Clock className="h-7 w-7 text-orange-500" />
            </div>
          )}
        </div>

        {/* Step indicators — vertical timeline */}
        <div className="relative space-y-0">
          {STEPS.map((step, idx) => {
            const Icon = step.icon
            const isActive = idx === curStep
            const isDone = idx < curStep
            const isLast = idx === STEPS.length - 1

            return (
              <div key={step.key} className="relative flex gap-4">
                {/* Left: icon + line */}
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={false}
                    animate={{
                      scale: isActive ? 1.15 : 1,
                      backgroundColor: isDone || isActive ? '#ea580c' : '#e2e8f0',
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      isDone || isActive ? 'text-white' : 'text-slate-400',
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={isDone || isActive ? 2.5 : 1.5} />
                  </motion.div>
                  {/* Connecting line */}
                  {!isLast && (
                    <div className="my-1 h-8 w-0.5 overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        initial={false}
                        animate={{ height: isDone ? '100%' : '0%' }}
                        transition={{ duration: 0.5, ease: 'easeInOut' }}
                        className="w-full bg-orange-500"
                      />
                    </div>
                  )}
                </div>

                {/* Right: label */}
                <div className={cn('pb-6', isLast && 'pb-0')}>
                  <p className={cn(
                    'text-[14px] font-semibold',
                    isDone || isActive ? 'text-slate-900' : 'text-slate-400',
                  )}>
                    {step.label}
                  </p>
                  <p className={cn(
                    'text-[12px]',
                    isDone || isActive ? 'text-slate-500' : 'text-slate-300',
                  )}>
                    {step.sublabel}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </motion.div>

      {/* Items list — Swiggy compact style */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
      >
        <h3 className="mb-3 text-[14px] font-bold text-slate-800">
          Your order ({order.items?.length || 0})
        </h3>
        <div className="space-y-3">
          {order.items?.map((it: any) => (
            <div key={it.id} className="flex items-start gap-2.5">
              <div className="mt-0.5">
                <VegBadge isVeg={it.isVeg} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-800">{it.menuItemName}</p>
                {it.variantName && (
                  <p className="text-[11px] text-slate-400">{it.variantName}</p>
                )}
                {it.modifiers?.length > 0 && (
                  <p className="truncate text-[11px] text-slate-400">
                    + {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[13px] font-semibold text-slate-800">
                  {it.quantity} × {formatINR(it.unitPrice || (it.totalPrice / it.quantity))}
                </p>
                <p className="text-[13px] font-bold text-slate-900">
                  {formatINR(it.totalPrice)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Totals — compact */}
        <div className="mt-4 space-y-1.5 border-t border-dashed border-slate-200 pt-3 text-[13px]">
          <BillRow label="Item total" value={order.subtotal} />
          {order.taxAmount > 0 && <BillRow label="Taxes & GST" value={order.taxAmount} />}
          {order.serviceCharge > 0 && <BillRow label="Service charge" value={order.serviceCharge} />}
          <div className="flex items-center justify-between border-t border-slate-200 pt-2.5">
            <span className="text-[15px] font-extrabold text-slate-900">Grand total</span>
            <span className="text-base font-extrabold text-slate-900">{formatINR(order.grandTotal)}</span>
          </div>
        </div>
      </motion.div>

      {/* Payment-requested panel — Zepto-style CTA card that opens the checkout sheet */}
      {needsToPay && (
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm"
        >
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-amber-600" />
              <h3 className="text-[14px] font-bold text-amber-900">
                {isPendingPayment || order.prePaymentRequested
                  ? 'Please pay before we accept'
                  : 'Settle your bill'}
              </h3>
            </div>
            <p className="mb-3 text-[13px] text-amber-700/80">
              {isPendingPayment || order.prePaymentRequested
                ? 'Your order goes to the kitchen once the payment is confirmed.'
                : 'Please settle the bill before leaving.'}
            </p>
            <div className="mb-3 flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
              <span className="text-[13px] font-medium text-slate-600">Amount due</span>
              <span className="text-lg font-extrabold text-slate-900">{formatINR(order.grandTotal)}</span>
            </div>
            <Button
              size="lg"
              className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99]"
              onClick={() => setCheckoutOpen(true)}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Pay {formatINR(order.grandTotal)}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Actions */}
      <div className="mt-2 flex flex-col gap-2.5 pb-4">
        {canCancel && (
          <Button
            variant="outline"
            className="h-11 rounded-xl border-red-200 text-red-600 hover:bg-red-50"
            disabled={cancel.isPending}
            onClick={async () => {
              try {
                await cancel.mutateAsync(orderId)
                toast.success('Order cancelled')
              } catch (err: any) {
                toast.error(err.message || 'Could not cancel')
              }
            }}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancel order
          </Button>
        )}
        {canRequestBill && (
          <Button
            size="lg"
            className="h-12 rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/20 hover:bg-orange-700"
            onClick={onProceedToBill}
          >
            Proceed to bill
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
        {isPaid && !isCompleted && (
          <div className="flex items-center gap-2.5 rounded-xl bg-green-50 p-3.5">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-[13px] font-medium text-green-700">
              Payment received — thank you!
            </p>
          </div>
        )}
        {isCompleted && (
          <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3.5">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <p className="text-[13px] font-medium text-slate-600">
              Order completed. Thank you for dining with us!
            </p>
          </div>
        )}
        <Button
          variant="ghost"
          className="h-11 text-slate-500 hover:text-slate-700"
          onClick={onBackToMenu}
        >
          ← Back to menu
        </Button>
      </div>

      {/* Zepto-style Checkout Sheet — replaces the old post-payment popup + inline picker.
          Opens automatically when order is SERVED (once per order), and any time the
          staff manually requests payment via /api/admin/orders/[id]/request-payment. */}
      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        restaurant={restaurant as RestaurantInfo}
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

function BillRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-500">
      <span>{label}</span>
      <span>{formatINR(value)}</span>
    </div>
  )
}
