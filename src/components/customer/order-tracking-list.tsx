'use client'

/**
 * Multi-order tracking list.
 *
 * When a customer places a follow-up order (via "Order more items") while a
 * previous order is still active, BOTH orders are shown here — each as an
 * independently collapsible / expandable card with its own tracking stepper,
 * order items, bill details, and actions (pay / order more / cancel).
 *
 * The most recent order is expanded by default; older active orders start
 * collapsed so the customer can focus on the latest one while still seeing
 * the status of every other active order at a glance.
 */
import { useState, useEffect, useMemo } from 'react'
import { useCustomerActiveOrders, useCancelOrder } from '@/hooks/api'
import { useSocketEvent } from '@/hooks/use-socket'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
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
  ChevronDown,
  Receipt,
  PlusCircle,
  ChefHat as ChefIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { VegBadge } from '@/components/restaurant/veg-badge'
import type { RestaurantInfo } from './types'
import { CheckoutSheet } from './checkout-sheet'

// ---------------------------------------------------------------------------
// Status config — compact stepper used inside each order card
// ---------------------------------------------------------------------------
interface StepConfig {
  key: string
  shortLabel: string
  icon: LucideIcon
}

const STEPS: StepConfig[] = [
  { key: 'NEW', shortLabel: 'Placed', icon: CheckCircle2 },
  { key: 'ACCEPTED', shortLabel: 'Confirmed', icon: BellRing },
  { key: 'PREPARING', shortLabel: 'Cooking', icon: ChefHat },
  { key: 'READY', shortLabel: 'Ready', icon: PackageCheck },
  { key: 'SERVED', shortLabel: 'Served', icon: Utensils },
]

function stepIndex(status: string): number {
  const order = ['NEW', 'PENDING_PAYMENT', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']
  const i = order.indexOf(status)
  if (i < 0) return 0
  // PENDING_PAYMENT maps to the "Placed" step
  if (status === 'PENDING_PAYMENT') return 0
  return Math.min(i, STEPS.length - 1)
}

function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function OrderTrackingList({
  phone,
  tableToken,
  restaurant,
  onBackToMenu,
  onOrderMore,
}: {
  phone: string
  tableToken: string
  restaurant: RestaurantInfo
  onBackToMenu: () => void
  /** Called when the customer wants to place ANOTHER fresh order. Receives the
   *  customer name & phone snapshot from the order they tapped it on. */
  onOrderMore: (customerName: string, customerPhone: string) => void
}) {
  const qc = useQueryClient()
  const { data, isLoading } = useCustomerActiveOrders(phone, tableToken)
  const cancel = useCancelOrder()
  // Most-recent order expanded by default; the rest collapsed.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [payOrderId, setPayOrderId] = useState<string | null>(null)
  const [billExpanded, setBillExpanded] = useState<Set<string>>(new Set())

  // ---- Socket subscriptions: refresh the list whenever any order changes ----
  useSocketEvent('order:updated', () => {
    qc.invalidateQueries({ queryKey: ['customer-active-orders', phone, tableToken] })
  })
  useSocketEvent('order:statusChanged', () => {
    qc.invalidateQueries({ queryKey: ['customer-active-orders', phone, tableToken] })
  })
  useSocketEvent('payment:confirmed', () => {
    qc.invalidateQueries({ queryKey: ['customer-active-orders', phone, tableToken] })
  })
  useSocketEvent('payment:requested', () => {
    qc.invalidateQueries({ queryKey: ['customer-active-orders', phone, tableToken] })
  })
  useSocketEvent('order:new', () => {
    qc.invalidateQueries({ queryKey: ['customer-active-orders', phone, tableToken] })
  })

  const orders = data?.orders || []

  // Auto-expand the most recent order when the list first loads / changes size.
  useEffect(() => {
    if (orders.length === 0) return
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev
      // Expand only the newest order by default
      return new Set([orders[0].id])
    })
  }, [orders.length])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleBill = (id: string) => {
    setBillExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => setExpandedIds(new Set(orders.map((o: any) => o.id)))
  const collapseAll = () => setExpandedIds(new Set())

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-gradient-to-b from-orange-50/40 to-white">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
            <ChefIcon className="h-7 w-7 text-orange-500 animate-pulse" />
          </div>
          <p className="text-[14px] font-semibold text-slate-700">Loading your orders…</p>
        </div>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <Receipt className="h-8 w-8 text-slate-400" />
        </div>
        <p className="text-[15px] font-bold text-slate-800">No active orders</p>
        <p className="mt-1 text-[13px] text-slate-400">
          You don&apos;t have any active orders right now.
        </p>
        <Button
          className="mt-4 rounded-xl bg-orange-600 text-white hover:bg-orange-700"
          onClick={onBackToMenu}
        >
          Browse menu
        </Button>
      </div>
    )
  }

  const activeCount = orders.length

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/30 via-white to-white pb-44 sm:pb-28">
      {/* ----- Sticky header ----- */}
      <div className="sticky top-0 z-20 border-b border-orange-100/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button
            onClick={onBackToMenu}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Back to menu"
          >
            <ChevronDown className="h-5 w-5 rotate-90" />
          </button>
          <div className="flex-1">
            <h1 className="text-[16px] font-extrabold tracking-tight text-slate-900">
              Your active orders
            </h1>
            <p className="mt-0.5 text-[11.5px] text-slate-400">
              {activeCount} order{activeCount !== 1 ? 's' : ''} · ••••{phone.slice(-4)}
            </p>
          </div>
          {activeCount > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-orange-600 transition-colors hover:bg-orange-50"
              >
                Expand all
              </button>
              <button
                onClick={collapseAll}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100"
              >
                Collapse
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ----- Order cards ----- */}
      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        <AnimatePresence initial={false}>
          {orders.map((order: any, idx: number) => {
            const isExpanded = expandedIds.has(order.id)
            const isLatest = idx === 0
            return (
              <OrderCard
                key={order.id}
                order={order}
                restaurant={restaurant}
                isExpanded={isExpanded}
                isLatest={isLatest}
                billOpen={billExpanded.has(order.id)}
                onToggle={() => toggleExpand(order.id)}
                onToggleBill={() => toggleBill(order.id)}
                onPay={() => setPayOrderId(order.id)}
                onOrderMore={() =>
                  onOrderMore(order.customerName || '', order.customerPhone || '')
                }
                onCancel={async () => {
                  try {
                    await cancel.mutateAsync(order.id)
                    toast.success(`Order ${order.orderNumber} cancelled`)
                    qc.invalidateQueries({
                      queryKey: ['customer-active-orders', phone, tableToken],
                    })
                  } catch (err: any) {
                    toast.error(err.message || 'Could not cancel')
                  }
                }}
                canceling={cancel.isPending}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {/* ----- Checkout sheet for paying a specific order ----- */}
      {payOrderId && (
        <CheckoutSheet
          open={!!payOrderId}
          onOpenChange={(o) => !o && setPayOrderId(null)}
          restaurant={restaurant}
          totals={{
            itemCount: 0,
            subtotal: 0,
            taxAmount: 0,
            serviceCharge: 0,
            grandTotal: 0,
          }}
          items={[]}
          existingOrderId={payOrderId}
          skipCustomerDetails
          onCheckoutComplete={() => {
            setPayOrderId(null)
            qc.invalidateQueries({
              queryKey: ['customer-active-orders', phone, tableToken],
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single collapsible order card
// ---------------------------------------------------------------------------
function OrderCard({
  order,
  restaurant,
  isExpanded,
  isLatest,
  billOpen,
  onToggle,
  onToggleBill,
  onPay,
  onOrderMore,
  onCancel,
  canceling,
}: {
  order: any
  restaurant: RestaurantInfo
  isExpanded: boolean
  isLatest: boolean
  billOpen: boolean
  onToggle: () => void
  onToggleBill: () => void
  onPay: () => void
  onOrderMore: () => void
  onCancel: () => void
  canceling: boolean
}) {
  const curStep = stepIndex(order.status)
  const isPaid = order.paymentStatus === 'PAID'
  const isCompleted = order.status === 'COMPLETED'
  const canCancel = order.status === 'NEW' || order.status === 'PENDING_PAYMENT'
  const needsToPay =
    !isPaid &&
    !isCompleted &&
    (order.status === 'PENDING_PAYMENT' ||
      !!order.prePaymentRequested ||
      !!order.postPaymentRequested)
  const canOrderMore = ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status)
  const itemCount = order.items?.length || 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow',
        isLatest ? 'border-orange-200 ring-1 ring-orange-100' : 'border-slate-200',
      )}
    >
      {/* ----- Card header (always visible, click to expand/collapse) ----- */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/60"
      >
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
            isLatest ? 'bg-orange-500' : 'bg-slate-400',
          )}
        >
          {isLatest ? <PlusCircle className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-extrabold text-slate-900">{order.orderNumber}</span>
            {isLatest && (
              <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                Latest
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Clock className="h-3 w-3" />
            <span>{timeAgo(order.placedAt)}</span>
            <span className="mx-0.5">·</span>
            <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
            <span className="mx-0.5">·</span>
            <PaymentStatusBadge status={order.paymentStatus} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[14px] font-extrabold text-slate-900">
            {formatINR(order.grandTotal)}
          </span>
          <OrderStatusBadge status={order.status} />
        </div>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-slate-400 transition-transform',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {/* ----- Expanded body ----- */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-slate-100"
          >
            <div className="space-y-4 px-4 py-4">
              {/* Compact horizontal stepper */}
              <div className="flex items-center justify-between">
                {STEPS.map((step, idx) => {
                  const Icon = step.icon
                  const isActive = idx === curStep
                  const isDone = idx < curStep
                  const isLast = idx === STEPS.length - 1
                  return (
                    <div key={step.key} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full ring-2 transition-all',
                            isActive
                              ? 'bg-orange-500 text-white ring-orange-200'
                              : isDone
                                ? 'bg-orange-500 text-white ring-transparent'
                                : 'bg-slate-100 text-slate-400 ring-transparent',
                          )}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </div>
                        <span
                          className={cn(
                            'text-[9px] font-semibold',
                            isActive ? 'text-orange-600' : isDone ? 'text-slate-700' : 'text-slate-400',
                          )}
                        >
                          {step.shortLabel}
                        </span>
                      </div>
                      {!isLast && (
                        <div className="mx-1 mb-4 h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              isDone ? 'bg-orange-500' : 'bg-transparent',
                            )}
                            style={{ width: isDone ? '100%' : '0%' }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Payment due banner */}
              {needsToPay && (
                <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-amber-700" />
                    <span className="text-[12px] font-semibold text-amber-900">
                      Payment due
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="h-9 rounded-lg bg-orange-600 text-[12px] font-bold text-white hover:bg-orange-700"
                    onClick={onPay}
                  >
                    Pay {formatINR(order.grandTotal)}
                  </Button>
                </div>
              )}

              {/* Paid / completed status pills */}
              {isPaid && !isCompleted && (
                <div className="flex items-center gap-2 rounded-xl bg-green-50 p-2.5">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-[12px] font-medium text-green-700">Payment received</span>
                </div>
              )}
              {isCompleted && (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2.5">
                  <CheckCircle2 className="h-4 w-4 text-orange-500" />
                  <span className="text-[12px] font-medium text-slate-700">Order completed</span>
                </div>
              )}

              {/* Order items */}
              <div className="rounded-xl border border-slate-100">
                <div className="border-b border-slate-100 px-3 py-2">
                  <span className="text-[12px] font-bold text-slate-700">
                    Order items ({itemCount})
                  </span>
                </div>
                <div className="divide-y divide-slate-50">
                  {order.items?.map((it: any) => (
                    <div key={it.id} className="flex items-start gap-2.5 px-3 py-2.5">
                      <div className="mt-0.5">
                        <VegBadge isVeg={it.isVeg} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-slate-800">
                          {it.menuItemName}
                        </p>
                        {it.variantName && (
                          <p className="text-[10.5px] text-slate-400">{it.variantName}</p>
                        )}
                        {it.modifiers?.length > 0 && (
                          <p className="truncate text-[10.5px] text-slate-400">
                            + {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10.5px] text-slate-400">{it.quantity}×</p>
                        <p className="text-[12.5px] font-bold text-slate-900">
                          {formatINR(it.totalPrice)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bill details (collapsible) */}
                <button
                  onClick={onToggleBill}
                  className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2.5 text-[12px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <span className="flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5 text-slate-400" />
                    Bill details
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-extrabold text-slate-900">
                      {formatINR(order.grandTotal)}
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-slate-400 transition-transform',
                        billOpen && 'rotate-180',
                      )}
                    />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {billOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-slate-50 bg-slate-50/50"
                    >
                      <div className="space-y-1.5 px-3 py-2.5 text-[11.5px]">
                        <BillRow label="Item total" value={order.subtotal} />
                        {order.taxAmount > 0 && (
                          <BillRow label="Taxes & GST" value={order.taxAmount} />
                        )}
                        {order.serviceCharge > 0 && (
                          <BillRow label="Service charge" value={order.serviceCharge} />
                        )}
                        <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                          <span className="text-[12px] font-extrabold text-slate-900">
                            Grand total
                          </span>
                          <span className="text-[12.5px] font-extrabold text-slate-900">
                            {formatINR(order.grandTotal)}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                {canOrderMore && (
                  <Button
                    className="h-11 w-full rounded-xl bg-orange-600 text-[14px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99]"
                    onClick={onOrderMore}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Order more items
                  </Button>
                )}
                {!needsToPay && !isCompleted && (
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-xl border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={onOrderMore}
                  >
                    Place another order
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="ghost"
                    className="h-9 w-full rounded-xl text-[12px] font-medium text-red-500 hover:bg-red-50 hover:text-red-600"
                    disabled={canceling}
                    onClick={onCancel}
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Cancel this order
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function BillRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span>{label}</span>
      <span className="font-medium text-slate-700">{formatINR(value)}</span>
    </div>
  )
}
