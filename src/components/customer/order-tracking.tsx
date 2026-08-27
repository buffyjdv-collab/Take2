'use client'

/**
 * Zepto-style order tracking page.
 *
 * Layout (top to bottom):
 *   1. Sticky translucent header     — order #, status badge, back button
 *   2. Hero status card               — big current status + ETA + animated icon
 *   3. Horizontal progress stepper    — Zepto-style pill timeline with icons
 *   4. Order items card                — items + qty + price, collapsible bill details
 *   5. Payment-CTA card (conditional)  — "Pay ₹X" CTA when payment is due
 *   6. Sticky bottom action bar       — primary CTA (Proceed to bill / Pay / Done)
 *
 * CRITICAL: All React Hooks (useState, useEffect, useSocketEvent) must be
 * declared BEFORE any early return. A previous version had the auto-open
 * useEffect AFTER the `if (isLoading || !order) return` check, which caused
 * React to throw "Rendered more hooks than during the previous render" —
 * this was the actual reason the tracking page wouldn't load.
 */
import { useState, useEffect } from 'react'
import { useCustomerOrder, useCancelOrder } from '@/hooks/api'
import { useSocketEvent } from '@/hooks/use-socket'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
import { LoadingSpinner } from '@/components/restaurant/loading-states'
import { formatINR } from '@/components/restaurant/price'
import {
  BellRing,
  CheckCircle2,
  Clock,
  ChefHat,
  PackageCheck,
  Utensils,
  XCircle,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  MapPin,
  ChevronDown,
  Receipt,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { VegBadge } from '@/components/restaurant/veg-badge'
import type { OrderStatus } from '@/lib/types'
import type { RestaurantInfo } from './types'
import { CheckoutSheet } from './checkout-sheet'

// ---------------------------------------------------------------------------
// Status config — drives the hero card + stepper
// ---------------------------------------------------------------------------
interface StepConfig {
  key: OrderStatus
  label: string
  shortLabel: string
  sublabel: string
  icon: LucideIcon
  etaText?: string
}

const STEPS: StepConfig[] = [
  { key: 'NEW', label: 'Order Placed', shortLabel: 'Placed', sublabel: 'Waiting for restaurant to accept', icon: CheckCircle2, etaText: '~20-25 min' },
  { key: 'ACCEPTED', label: 'Confirmed', shortLabel: 'Confirmed', sublabel: 'Restaurant has accepted your order', icon: BellRing, etaText: '~15-20 min' },
  { key: 'PREPARING', label: 'Preparing', shortLabel: 'Cooking', sublabel: 'The chef is preparing your food', icon: ChefHat, etaText: '~10-15 min' },
  { key: 'READY', label: 'Ready to Serve', shortLabel: 'Ready', sublabel: 'Your food is ready for serving', icon: PackageCheck, etaText: '~2-5 min' },
  { key: 'SERVED', label: 'Served', shortLabel: 'Served', sublabel: 'Enjoy your meal!', icon: Utensils, etaText: 'Enjoy!' },
]

function stepIndex(status: string): number {
  const order: string[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']
  const i = order.indexOf(status)
  if (i < 0) return -1
  return Math.min(i, STEPS.length - 1)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
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
  const [billExpanded, setBillExpanded] = useState(false)

  // ---- Socket subscriptions (always called, regardless of loading state) ----
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

  // ---- Derived state (safe to compute even if order is undefined) ----
  const isPaid = order?.paymentStatus === 'PAID'
  const isCompleted = order?.status === 'COMPLETED'
  const isPendingPayment = order?.status === 'PENDING_PAYMENT'
  const isServed = order?.status === 'SERVED'
  const needsToPay =
    !!order &&
    !isPaid &&
    (isPendingPayment || !!order.prePaymentRequested || !!order.postPaymentRequested)

  // ---- Auto-open the checkout sheet once when order is SERVED ----
  // (Zepto-style post-meal payment prompt). MUST be before any early return.
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

  // ---- Loading state (only AFTER all hooks are declared) ----
  if (isLoading || !order) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-gradient-to-b from-orange-50/40 to-white">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
            <ChefHat className="h-7 w-7 text-orange-500 animate-pulse" />
          </div>
          <p className="text-[14px] font-semibold text-slate-700">Loading your order…</p>
          <p className="mt-1 text-[12px] text-slate-400">Just a moment</p>
        </div>
      </div>
    )
  }

  // ---- Now safe to use order (loaded) ----
  const curStep = stepIndex(order.status)
  const canCancel = order.status === 'NEW' || order.status === 'PENDING_PAYMENT'
  const canRequestBill = ['SERVED', 'READY'].includes(order.status) && order.paymentStatus !== 'PAID'
  const currentStepConfig = STEPS[Math.max(curStep, 0)]
  const etaText = isCompleted ? null : currentStepConfig?.etaText
  const HeroIcon = currentStepConfig?.icon || Clock
  const itemCount = order.items?.length || 0

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/40 via-white to-white pb-28">
      {/* ----- Sticky header ----- */}
      <div className="sticky top-0 z-20 border-b border-orange-100/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button
            onClick={onBackToMenu}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-extrabold tracking-tight text-slate-900">
                {order.orderNumber}
              </h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <MapPin className="h-3 w-3" />
              <span>Table {order.table?.number} · Dine-in</span>
              <span className="mx-0.5">·</span>
              <PaymentStatusBadge status={order.paymentStatus} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4">
        {/* ----- Hero status card (Zepto-style big card) ----- */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-orange-50/30 p-5 shadow-sm"
        >
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-orange-200/30 blur-3xl" />

          <div className="relative flex items-start justify-between">
            <div className="flex-1">
              <p className="text-[12px] font-bold uppercase tracking-wider text-orange-600">
                {isCompleted ? 'Order Complete' : 'Status'}
              </p>
              <h2 className="mt-1 text-[24px] font-extrabold leading-tight text-slate-900">
                {isCompleted ? 'All done!' : currentStepConfig?.label || 'Processing'}
              </h2>
              <p className="mt-1 text-[13px] text-slate-500">
                {currentStepConfig?.sublabel}
              </p>

              {etaText && !isCompleted && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-orange-700 shadow-sm ring-1 ring-orange-100">
                  <Clock className="h-3.5 w-3.5" />
                  ETA {etaText}
                </div>
              )}
            </div>

            {/* Animated status icon */}
            <motion.div
              initial={{ scale: 0.8, rotate: -5 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
              className={cn(
                'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl shadow-md',
                isCompleted ? 'bg-green-100' : 'bg-orange-500',
              )}
            >
              <HeroIcon
                className={cn('h-8 w-8', isCompleted ? 'text-green-600' : 'text-white')}
                strokeWidth={2.25}
              />
            </motion.div>
          </div>
        </motion.div>

        {/* ----- Horizontal progress stepper (Zepto-style) ----- */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            {STEPS.map((step, idx) => {
              const Icon = step.icon
              const isActive = idx === curStep
              const isDone = idx < curStep
              const isLast = idx === STEPS.length - 1

              return (
                <div key={step.key} className="flex flex-1 items-center">
                  {/* Step circle */}
                  <div className="flex flex-col items-center gap-1">
                    <motion.div
                      initial={false}
                      animate={{
                        scale: isActive ? 1.12 : 1,
                        backgroundColor: isDone || isActive ? '#ea580c' : '#f1f5f9',
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full ring-2 transition-colors',
                        isActive ? 'ring-orange-200' : 'ring-transparent',
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={2.5} />
                      ) : (
                        <Icon
                          className={cn(
                            'h-4 w-4',
                            isActive ? 'text-white' : 'text-slate-400',
                          )}
                          strokeWidth={isActive ? 2.5 : 1.75}
                        />
                      )}
                    </motion.div>
                    <span
                      className={cn(
                        'text-[10px] font-semibold tracking-wide',
                        isActive ? 'text-orange-600' : isDone ? 'text-slate-700' : 'text-slate-400',
                      )}
                    >
                      {step.shortLabel}
                    </span>
                  </div>

                  {/* Connecting line */}
                  {!isLast && (
                    <div className="mx-1 mb-5 h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        initial={false}
                        animate={{ width: isDone ? '100%' : '0%' }}
                        transition={{ duration: 0.5, ease: 'easeInOut' }}
                        className="h-full bg-gradient-to-r from-orange-400 to-orange-500"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>

        {/* ----- Payment-CTA card (Zepto-style — shows when payment is due) ----- */}
        <AnimatePresence>
          {needsToPay && (
            <motion.div
              initial={{ y: 12, opacity: 0, height: 0 }}
              animate={{ y: 0, opacity: 1, height: 'auto' }}
              exit={{ y: 8, opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm"
            >
              <div className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
                    <CreditCard className="h-4 w-4 text-amber-700" />
                  </div>
                  <h3 className="text-[14px] font-bold text-amber-900">
                    {isPendingPayment || order.prePaymentRequested
                      ? 'Please pay to confirm'
                      : 'Settle your bill'}
                  </h3>
                </div>
                <p className="mb-3 text-[12.5px] text-amber-700/90">
                  {isPendingPayment || order.prePaymentRequested
                    ? 'Your order goes to the kitchen once payment is confirmed.'
                    : 'Please settle the bill before leaving.'}
                </p>
                <div className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
                  <span className="text-[13px] font-medium text-slate-600">Amount due</span>
                  <span className="text-[18px] font-extrabold text-slate-900">
                    {formatINR(order.grandTotal)}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ----- Order items card ----- */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-[14px] font-bold text-slate-800">
              Your order
              <span className="ml-1.5 text-[12px] font-medium text-slate-400">
                ({itemCount} item{itemCount !== 1 ? 's' : ''})
              </span>
            </h3>
            <span className="text-[13px] font-bold text-slate-700">
              {formatINR(order.grandTotal)}
            </span>
          </div>

          <div className="divide-y divide-slate-50">
            {order.items?.map((it: any) => (
              <div key={it.id} className="flex items-start gap-2.5 px-4 py-3">
                <div className="mt-0.5">
                  <VegBadge isVeg={it.isVeg} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-slate-800">
                    {it.menuItemName}
                  </p>
                  {it.variantName && (
                    <p className="mt-0.5 text-[11.5px] text-slate-400">{it.variantName}</p>
                  )}
                  {it.modifiers?.length > 0 && (
                    <p className="mt-0.5 truncate text-[11.5px] text-slate-400">
                      + {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[12px] text-slate-400">
                    {it.quantity} × {formatINR(it.unitPrice || it.totalPrice / it.quantity)}
                  </p>
                  <p className="text-[13.5px] font-bold text-slate-900">
                    {formatINR(it.totalPrice)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Bill details — collapsible */}
          <button
            onClick={() => setBillExpanded((v) => !v)}
            className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <span className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-slate-400" />
              Bill details
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-slate-400 transition-transform',
                billExpanded && 'rotate-180',
              )}
            />
          </button>
          <AnimatePresence>
            {billExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden border-t border-slate-50 bg-slate-50/50"
              >
                <div className="space-y-1.5 px-4 py-3 text-[12.5px]">
                  <BillRow label="Item total" value={order.subtotal} />
                  {order.taxAmount > 0 && <BillRow label="Taxes & GST" value={order.taxAmount} />}
                  {order.serviceCharge > 0 && (
                    <BillRow label="Service charge" value={order.serviceCharge} />
                  )}
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                    <span className="text-[13.5px] font-extrabold text-slate-900">Grand total</span>
                    <span className="text-[14px] font-extrabold text-slate-900">
                      {formatINR(order.grandTotal)}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ----- Status messages (paid / completed) ----- */}
        {isPaid && !isCompleted && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-3 flex items-center gap-2.5 rounded-xl bg-green-50 p-3.5"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            <p className="text-[13px] font-medium text-green-700">
              Payment received — thank you!
            </p>
          </motion.div>
        )}
        {isCompleted && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-3 flex items-center gap-2.5 rounded-xl bg-slate-50 p-3.5"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-orange-500" />
            <p className="text-[13px] font-medium text-slate-700">
              Order completed. Thank you for dining with us!
            </p>
          </motion.div>
        )}

        {/* ----- Cancel (only on NEW / PENDING_PAYMENT orders) ----- */}
        {canCancel && (
          <div className="mt-3">
            <Button
              variant="ghost"
              className="h-10 w-full rounded-xl text-[13px] font-medium text-red-500 hover:bg-red-50 hover:text-red-600"
              disabled={cancel.isPending}
              onClick={async () => {
                try {
                  await cancel.mutateAsync(orderId)
                  toast.success('Order cancelled')
                  onBackToMenu()
                } catch (err: any) {
                  toast.error(err.message || 'Could not cancel')
                }
              }}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancel order
            </Button>
          </div>
        )}
      </div>

      {/* ----- Sticky bottom action bar ----- */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {needsToPay ? (
            <Button
              size="lg"
              className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/30 transition-all hover:bg-orange-700 active:scale-[0.99]"
              onClick={() => setCheckoutOpen(true)}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Pay {formatINR(order.grandTotal)}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : canRequestBill ? (
            <Button
              size="lg"
              className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/30 transition-all hover:bg-orange-700 active:scale-[0.99]"
              onClick={onProceedToBill}
            >
              Proceed to bill
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : isCompleted ? (
            <Button
              size="lg"
              className="h-12 w-full rounded-xl bg-slate-900 text-[15px] font-bold text-white transition-all hover:bg-slate-800 active:scale-[0.99]"
              onClick={onBackToMenu}
            >
              Place another order
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full rounded-xl border-slate-300 text-[15px] font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onBackToMenu}
            >
              Back to menu
            </Button>
          )}
        </div>
      </div>

      {/* ----- Zepto-style Checkout Sheet ----- */}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function BillRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span>{label}</span>
      <span className="font-medium text-slate-700">{formatINR(value)}</span>
    </div>
  )
}
