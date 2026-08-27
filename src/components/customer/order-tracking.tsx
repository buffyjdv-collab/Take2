'use client'

import { useState, useEffect } from 'react'
import { useCustomerOrder, useCancelOrder, useInitiatePayment, useVerifyPayment } from '@/hooks/api'
import { useSocketEvent } from '@/hooks/use-socket'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
import { LoadingSpinner, EmptyState } from '@/components/restaurant/loading-states'
import { Price, formatINR } from '@/components/restaurant/price'
import { BellRing, CheckCircle2, Clock, ChefHat, PackageCheck, Utensils, XCircle, CreditCard, Loader2, Smartphone, QrCode, Banknote, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { OrderStatus } from '@/lib/types'
import type { RestaurantInfo } from './types'

const STEPS: { key: OrderStatus; label: string; icon: any }[] = [
  { key: 'NEW', label: 'Placed', icon: CheckCircle2 },
  { key: 'ACCEPTED', label: 'Accepted', icon: BellRing },
  { key: 'PREPARING', label: 'Preparing', icon: ChefHat },
  { key: 'READY', label: 'Ready', icon: PackageCheck },
  { key: 'SERVED', label: 'Served', icon: Utensils },
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
  const initiate = useInitiatePayment()
  const verify = useVerifyPayment()
  const [paying, setPaying] = useState(false)

  // Real-time updates
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
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

  // If the restaurant has asked the customer to pay (pre or post), show a
  // prominent payment panel so the customer can settle the bill immediately.
  // PENDING_PAYMENT status itself implies the customer needs to pay upfront.
  const needsToPay =
    !isPaid &&
    (isPendingPayment || order.prePaymentRequested || order.postPaymentRequested)
  const acceptUpi = restaurant?.acceptUpi ?? true
  const acceptCash = restaurant?.acceptCash ?? true
  const upiId = restaurant?.upiId || null

  // Post-payment popup: show a modal when the order is SERVED and not yet paid.
  // The customer can dismiss it, but it auto-opens the first time the order
  // reaches SERVED status (tracked via sessionStorage so it doesn't re-open
  // on every refresh).
  const [postPaymentPopupOpen, setPostPaymentPopupOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'QR' | 'CASH' | null>(null)
  const [upiDeepLink, setUpiDeepLink] = useState<string | null>(null)
  const [upiQrPayload, setUpiQrPayload] = useState<string | null>(null)

  useEffect(() => {
    if (
      isServed &&
      !isPaid &&
      !sessionStorage.getItem(`postpay-popup-${orderId}`)
    ) {
      setPostPaymentPopupOpen(true)
      sessionStorage.setItem(`postpay-popup-${orderId}`, 'shown')
    }
  }, [isServed, isPaid, orderId])

  const handlePay = async (method: 'UPI' | 'WALLET') => {
    setPaying(true)
    setPaymentMethod(method === 'UPI' ? 'UPI' : 'CASH')
    try {
      const init = await initiate.mutateAsync({ orderId, method })
      if (method === 'UPI') {
        setUpiDeepLink(init.upiDeepLink || null)
        setUpiQrPayload(init.upiQrPayload || null)
        // For UPI method: open the deep link to launch the customer's UPI app
        if (init.upiDeepLink) {
          window.location.href = init.upiDeepLink
          return // page is navigating away — nothing else to do
        }
      }
      // Simulate payment verification (in production this would be a webhook)
      await new Promise((r) => setTimeout(r, init.verifyInMs || 3000))
      await verify.mutateAsync({
        paymentId: init.paymentId,
        providerTxnId: init.providerTxnId,
      })
      toast.success('Payment successful!')
      setPostPaymentPopupOpen(false)
      setPaymentMethod(null)
    } catch (err: any) {
      toast.error(err.message || 'Payment failed')
      setPaymentMethod(null)
    } finally {
      setPaying(false)
    }
  }

  // For the inline payment panel (PENDING_PAYMENT or pre/post payment requested)
  const handleInlinePay = async (method: 'UPI' | 'WALLET') => {
    setPaying(true)
    try {
      const init = await initiate.mutateAsync({ orderId, method })
      if (method === 'UPI' && init.upiDeepLink) {
        window.location.href = init.upiDeepLink
        return // page is navigating away — nothing else to do
      }
      toast.info('Connecting to payment gateway…')
      await new Promise((r) => setTimeout(r, init.verifyInMs || 3000))
      await verify.mutateAsync({
        paymentId: init.paymentId,
        providerTxnId: init.providerTxnId,
      })
      toast.success('Payment successful!')
    } catch (err: any) {
      toast.error(err.message || 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  const copyUpiId = () => {
    if (upiId) {
      navigator.clipboard.writeText(upiId)
      toast.success('UPI ID copied')
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Order</p>
          <h1 className="text-xl font-bold">{order.orderNumber}</h1>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </div>

      {/* Status timeline */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-orange-600" />
            Order progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            {STEPS.map((s, idx) => {
              const Icon = s.icon
              const done = idx <= curStep
              const active = idx === curStep
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center text-center">
                  <div className="flex w-full items-center">
                    <div
                      className={cn(
                        'h-1 flex-1 rounded-full',
                        idx === 0 ? 'bg-transparent' : done ? 'bg-orange-500' : 'bg-slate-200',
                      )}
                    />
                    <motion.div
                      initial={false}
                      animate={{
                        scale: active ? 1.1 : 1,
                        backgroundColor: done ? '#EA580C' : '#E2E8F0',
                      }}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full text-white',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </motion.div>
                    <div
                      className={cn(
                        'h-1 flex-1 rounded-full',
                        idx === STEPS.length - 1 ? 'bg-transparent' : idx < curStep ? 'bg-orange-500' : 'bg-slate-200',
                      )}
                    />
                  </div>
                  <span
                    className={cn(
                      'mt-1 text-[11px] font-medium',
                      done ? 'text-orange-700' : 'text-muted-foreground',
                    )}
                  >
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Prep estimate */}
          {order.status === 'NEW' && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Waiting for kitchen to accept your order…
            </p>
          )}
          {order.status === 'ACCEPTED' && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Your order will start preparing shortly.
            </p>
          )}
          {order.status === 'PREPARING' && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              <ChefHat className="mr-1 inline h-3 w-3" />
              Our chefs are cooking it up — typically 15-20 minutes.
            </p>
          )}
          {order.status === 'READY' && (
            <p className="mt-3 text-center text-xs font-semibold text-green-600">
              Your order is ready! A waiter will serve it shortly.
            </p>
          )}
          {order.status === 'SERVED' && (
            <p className="mt-3 text-center text-xs font-semibold text-purple-600">
              Enjoy your meal! Tap “Proceed to bill” when you're ready.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Items list */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Your items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.items?.map((it: any) => (
            <div key={it.id} className="flex gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                {it.quantity}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{it.menuItemName}</p>
                {it.variantName && (
                  <p className="text-xs text-muted-foreground">Size: {it.variantName}</p>
                )}
                {it.modifiers?.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                  </p>
                )}
                {it.notes && (
                  <p className="text-xs italic text-muted-foreground">“{it.notes}”</p>
                )}
              </div>
              <Price amount={it.totalPrice} size="sm" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Totals */}
      <Card className="mb-4">
        <CardContent className="space-y-1 py-4 text-sm">
          <Row label="Subtotal" value={order.subtotal} />
          {order.taxAmount > 0 && <Row label="Taxes & GST" value={order.taxAmount} />}
          {order.serviceCharge > 0 && <Row label="Service charge" value={order.serviceCharge} />}
          <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
            <span>Total</span>
            <Price amount={order.grandTotal} size="lg" />
          </div>
        </CardContent>
      </Card>

      {/* Payment-requested panel — shown when the restaurant asks the customer
          to pay before accepting (PRE) or after receiving (POST) the order.
          Also shown when the order is in PENDING_PAYMENT status (auto pre-payment). */}
      {needsToPay && (
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                <CreditCard className="h-4 w-4" />
                {isPendingPayment || order.prePaymentRequested
                  ? 'Please pay before we accept your order'
                  : 'Please pay to complete your order'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-amber-800">
                {isPendingPayment || order.prePaymentRequested
                  ? 'This restaurant requires upfront payment. Your order will be sent to the kitchen automatically once payment is confirmed.'
                  : 'Your order has been received. Please settle the bill before leaving the table.'}
              </p>
              <div className="flex items-center justify-between rounded-lg bg-white p-3 text-sm shadow-sm">
                <span className="font-medium text-slate-700">Amount due</span>
                <span className="text-lg font-bold text-amber-900">
                  {formatINR(order.grandTotal)}
                </span>
              </div>

              {/* Payment method buttons — UPI / Scan QR / Cash */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {acceptUpi && upiId && (
                  <Button
                    variant="outline"
                    className="bg-white"
                    disabled={paying}
                    onClick={() => handleInlinePay('UPI')}
                  >
                    <Smartphone className="mr-2 h-4 w-4 text-orange-600" />
                    Pay by UPI
                  </Button>
                )}
                {acceptUpi && upiId && (
                  <Button
                    variant="outline"
                    className="bg-white"
                    disabled={paying}
                    onClick={() => {
                      // For QR: initiate UPI payment then show the QR code in a dialog
                      setPaymentMethod('QR')
                      handleInlinePay('UPI')
                    }}
                  >
                    <QrCode className="mr-2 h-4 w-4 text-purple-600" />
                    Scan QR
                  </Button>
                )}
                {acceptCash && (
                  <Button
                    variant="outline"
                    className="bg-white"
                    disabled={paying}
                    onClick={() => {
                      toast.info('Please hand the cash to your waiter.', {
                        description: 'They will mark your order as paid.',
                        duration: 5000,
                      })
                    }}
                  >
                    <Banknote className="mr-2 h-4 w-4 text-emerald-600" />
                    Pay in cash
                  </Button>
                )}
              </div>

              {paying && (
                <div className="flex items-center justify-center gap-2 text-sm text-amber-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing payment…
                </div>
              )}

              {upiId && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">UPI ID:</span>
                  <code className="font-mono text-slate-700">{upiId}</code>
                  <button
                    onClick={copyUpiId}
                    className="text-orange-600 hover:underline"
                    aria-label="Copy UPI ID"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}

              {!upiId && acceptUpi && (
                <p className="text-center text-xs text-amber-700">
                  UPI payment is not available for this restaurant (no UPI ID configured).
                  Please pay in cash.
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {canCancel && (
          <Button
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50"
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
            className="bg-orange-600 text-white hover:bg-orange-700"
            onClick={onProceedToBill}
          >
            Proceed to bill
          </Button>
        )}
        {isPaid && !isCompleted && (
          <div className="rounded-lg bg-green-50 p-3 text-center text-sm text-green-700">
            <CheckCircle2 className="mx-auto mb-1 h-5 w-5" />
            Payment received — thank you!
          </div>
        )}
        {isCompleted && (
          <div className="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-700">
            <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-green-600" />
            Order completed. Thank you for dining with us!
          </div>
        )}
        <Button variant="ghost" onClick={onBackToMenu}>
          Back to menu
        </Button>
      </div>

      {/* Post-payment popup — auto-opens when order reaches SERVED status.
          The customer can pay via UPI / Scan QR / Cash directly from the popup. */}
      <Dialog open={postPaymentPopupOpen} onOpenChange={(o) => { if (!paying) setPostPaymentPopupOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Utensils className="h-5 w-5 text-purple-600" />
              Enjoy your meal!
            </DialogTitle>
          </DialogHeader>

          {paying ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              {paymentMethod === 'QR' && upiQrPayload ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Scan this QR code with your UPI app to pay
                    <strong> {formatINR(order.grandTotal)}</strong>
                  </p>
                  <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
                    <QrCodeDisplay payload={upiQrPayload} />
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
                  <p className="text-sm text-muted-foreground">
                    {paymentMethod === 'UPI'
                      ? 'Your UPI app should have opened. Waiting for payment…'
                      : 'Processing…'}
                  </p>
                </>
              )}
              {upiId && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">UPI ID:</span>
                  <code className="font-mono text-slate-700">{upiId}</code>
                  <button
                    onClick={copyUpiId}
                    className="text-orange-600 hover:underline"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your order has been served. Whenever you&apos;re ready, settle the
                bill using one of the methods below.
              </p>

              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <span className="text-sm font-medium text-slate-700">Amount due</span>
                <span className="text-lg font-bold text-slate-900">
                  {formatINR(order.grandTotal)}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {acceptUpi && upiId && (
                  <button
                    onClick={() => handlePay('UPI')}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-orange-400 hover:bg-orange-50/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                      <Smartphone className="h-5 w-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Pay by UPI</p>
                      <p className="text-xs text-muted-foreground">
                        Opens your UPI app with {formatINR(order.grandTotal)} pre-filled
                      </p>
                    </div>
                  </button>
                )}

                {acceptUpi && upiId && (
                  <button
                    onClick={() => {
                      setPaymentMethod('QR')
                      handlePay('UPI')
                    }}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-purple-400 hover:bg-purple-50/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                      <QrCode className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Scan QR code</p>
                      <p className="text-xs text-muted-foreground">
                        Scan with GPay / PhonePe / Paytm
                      </p>
                    </div>
                  </button>
                )}

                {acceptCash && (
                  <button
                    onClick={() => {
                      setPostPaymentPopupOpen(false)
                      toast.info('Please hand the cash to your waiter.', {
                        description: 'They will mark your order as paid.',
                        duration: 5000,
                      })
                    }}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-emerald-400 hover:bg-emerald-50/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                      <Banknote className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Pay in cash</p>
                      <p className="text-xs text-muted-foreground">
                        Hand cash to your waiter
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {!upiId && (
                <p className="text-center text-xs text-amber-700">
                  UPI / QR payment is not available for this restaurant (no UPI ID configured).
                  Please pay in cash.
                </p>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setPostPaymentPopupOpen(false)}
              >
                I&apos;ll pay later
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
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

// ---------------------------------------------------------------------------
// QR code display — generates a QR code from a string payload using the
// `qrcode` library (already in the project for table QR codes).
// ---------------------------------------------------------------------------
function QrCodeDisplay({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('qrcode').then((QRCode) => {
      QRCode.toDataURL(payload, {
        width: 256,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url: string) => {
          if (!cancelled) setDataUrl(url)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }).catch(() => {
      if (!cancelled) setError(true)
    })
    return () => {
      cancelled = true
    }
  }, [payload])

  if (error) {
    return (
      <div className="flex h-48 w-48 items-center justify-center text-center text-xs text-red-600">
        Failed to generate QR code.
      </div>
    )
  }

  if (!dataUrl) {
    return (
      <div className="flex h-48 w-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <img src={dataUrl} alt="UPI payment QR code" className="h-48 w-48" />
}
