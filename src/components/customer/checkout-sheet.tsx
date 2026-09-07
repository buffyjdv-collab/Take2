'use client'

/**
 * Zepto-style checkout sheet.
 *
 * A full-height bottom sheet that replaces the legacy inline checkout Dialog
 * in cart-drawer.tsx. The flow is:
 *
 *   Step 1 — "Details"   : Customer name + phone, "Continue to payment"
 *   Step 2 — "Payment"    : Order summary + PaymentMethodPicker + sticky "Pay ₹X" CTA
 *   Step 3 — Method flow : UPI deep-link launch / QR display / mock card+wallet
 *   Step 4 — "Success"   : Confirmation + redirect to tracking
 *
 * The picker is single-select (not "tap = pay"). The customer picks a method,
 * then taps the sticky bottom CTA — exactly like Zepto, Swiggy, Zomato.
 *
 * Used by:
 *   - cart-drawer.tsx (initial order placement)
 *   - bill-view.tsx (pay from the bill view, order already placed)
 *   - order-tracking.tsx (inline "please pay" panel when staff requests payment)
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Smartphone,
  QrCode,
  Banknote,
  Loader2,
  CheckCircle2,
  Copy,
  ChevronLeft,
  ShieldCheck,
  Lock,
  AlertCircle,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  usePlaceOrder,
  useInitiatePayment,
  useVerifyPayment,
} from '@/hooks/api'
import type { CartItem } from '@/lib/types'
import type { RestaurantInfo, PaymentMethodT } from './types'
import {
  PaymentMethodPicker,
  filterAvailableForCheckout,
} from './payment-method-picker'

interface Totals {
  itemCount: number
  subtotal: number
  taxAmount: number
  serviceCharge: number
  grandTotal: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurant: RestaurantInfo
  totals: Totals
  items: CartItem[]
  /** Called when an order has been placed + payment (if any) is done. The
   *  customerPhone is passed up so the parent (customer-app) can store it and
   *  use it to fetch ALL active orders for that mobile number (multi-order
   *  tracking list). */
  onCheckoutComplete: (orderId: string, customerPhone?: string) => void
  /** Optional: if provided, the sheet operates in "pay existing order" mode
   *  (used by bill-view + order-tracking). When undefined, the sheet first
   *  creates a new order via /api/customer/order. */
  existingOrderId?: string
  /** Optional: hide the customer-details step (used when name/phone already
   *  recorded on the order). */
  skipCustomerDetails?: boolean
  /** Optional: IDs of payment-method rows to HIDE from the picker. Used by
   *  order-tracking to hide the "Pay on delivery" method the customer already
   *  chose at order placement, so they're not asked to pick it again
   *  post-serve. */
  hiddenMethodIds?: string[]
  /** Optional: pre-fill the customer-details step with a name. Used when the
   *  customer places a fresh follow-up order after a previous accepted order
   *  — they keep the same customer name & mobile, so we pre-fill the form. */
  initialCustomerName?: string
  /** Optional: pre-fill the customer-details step with a phone number. */
  initialCustomerPhone?: string
}

type Step = 'details' | 'method' | 'upi_launch' | 'qr' | 'processing' | 'success' | 'error'

const ICON_FOR_METHOD: Record<string, LucideIcon> = {
  UPI: Smartphone,
  QR: QrCode,
  CASH: Banknote,
  CARD: Smartphone,
  WALLET: Smartphone,
  NETBANKING: Smartphone,
  COUNTER: Banknote,
  PAY_LATER: Banknote,
  CUSTOM: Smartphone,
}

export function CheckoutSheet({
  open,
  onOpenChange,
  restaurant,
  totals,
  items,
  onCheckoutComplete,
  existingOrderId,
  skipCustomerDetails,
  hiddenMethodIds = [],
  initialCustomerName = '',
  initialCustomerPhone = '',
}: Props) {
  const placeOrder = usePlaceOrder()
  const initiate = useInitiatePayment()
  const verify = useVerifyPayment()

  const [step, setStep] = useState<Step>(skipCustomerDetails ? 'method' : 'details')
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone)
  const [touched, setTouched] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodT | null>(null)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(existingOrderId || null)
  const [upiDeepLink, setUpiDeepLink] = useState<string | null>(null)
  const [upiQrPayload, setUpiQrPayload] = useState<string | null>(null)
  const [upiId, setUpiId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Reset everything when the sheet closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        if (step !== 'processing') {
          setStep(skipCustomerDetails ? 'method' : 'details')
          setSelectedMethod(null)
          setUpiDeepLink(null)
          setUpiQrPayload(null)
          setUpiId(null)
          setTouched(false)
          setSuccessMessage('')
          // CRITICAL for the "Order more items" flow: clear the placed-order
          // id so the NEXT open starts a FRESH new order. Without this, the
          // same mounted sheet would re-use order #1's id for order #2 and
          // `ensureOrderPlaced()` would short-circuit without creating a new
          // order. In existing-order mode (post-serve payment) we keep the
          // existing id.
          setPlacedOrderId(existingOrderId || null)
          // Restore the pre-filled customer details when the sheet re-opens —
          // this matters for the "order more items" follow-up flow where the
          // customer keeps the same name & mobile across orders.
          setCustomerName(initialCustomerName)
          setCustomerPhone(initialCustomerPhone)
        }
      }, 300)
      return () => clearTimeout(t)
    }
  }, [open, step, skipCustomerDetails, initialCustomerName, initialCustomerPhone, existingOrderId])

  // Sync pre-filled customer details whenever the sheet opens with new
  // initial values. The CheckoutSheet stays mounted (only `open` toggles), so
  // useState initialisers don't re-run — this effect applies fresh prefill
  // values supplied by the parent (e.g. right after the customer taps
  // "Order more items" on the tracking page). It also guarantees that, in
  // new-order mode, any previously placed order id is cleared so a genuinely
  // NEW order is created (defence-in-depth alongside the close-reset above).
  useEffect(() => {
    if (open) {
      setCustomerName((prev) => initialCustomerName || prev)
      setCustomerPhone((prev) => initialCustomerPhone || prev)
      if (!existingOrderId) setPlacedOrderId(null)
    }
  }, [open, initialCustomerName, initialCustomerPhone, existingOrderId])

  const availableMethods = useMemo(
    () => filterAvailableForCheckout(restaurant.paymentMethods),
    [restaurant.paymentMethods],
  )

  const nameValid = customerName.trim().length >= 2
  const digits = customerPhone.replace(/[^\d]/g, '')
  const phoneValid = digits.length >= 7 && digits.length <= 15
  const formValid = nameValid && phoneValid

  const grandTotal = totals.grandTotal
  const totalDisplay = `₹${grandTotal.toFixed(0)}`

  // --------------------------------------------------------------------------
  // Action: place order (only when no existingOrderId was provided)
  // --------------------------------------------------------------------------
  async function ensureOrderPlaced(): Promise<string | null> {
    if (placedOrderId) return placedOrderId
    if (!formValid) {
      setTouched(true)
      toast.error('Please enter your name and phone number.')
      return null
    }
    const idempotencyKey =
      sessionStorage.getItem('last-idem-key') ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
    sessionStorage.setItem('last-idem-key', idempotencyKey)

    const body = {
      tableToken: new URLSearchParams(window.location.search).get('table') || '',
      items: items.map((i: CartItem) => ({
        menuItemId: i.menuItemId,
        variantId: i.variantId,
        modifierIds: i.modifierIds,
        quantity: i.quantity,
        notes: i.notes,
      })),
      idempotencyKey,
      customerInfo: {
        name: customerName.trim(),
        phone: customerPhone.trim(),
      },
      // Persist the chosen payment-method ID on the order so the post-serve
      // picker can hide the same pay-on-delivery method if the customer picked
      // one (Cash / Counter / Pay Later).
      paymentMethodId: selectedMethod?.id || null,
    }
    const order = await placeOrder.mutateAsync(body)
    sessionStorage.removeItem('last-idem-key')
    setPlacedOrderId(order.id)
    return order.id
  }

  // --------------------------------------------------------------------------
  // Action: trigger the selected payment method's flow
  // --------------------------------------------------------------------------
  async function handlePay() {
    if (!selectedMethod) {
      toast.error('Please choose a payment method.')
      return
    }

    try {
      const orderId = await ensureOrderPlaced()
      if (!orderId) return

      const t = selectedMethod.type
      // Cash / Counter / Pay-Later: no online payment — staff mark as paid.
      if (t === 'CASH' || t === 'COUNTER' || t === 'PAY_LATER') {
        setStep('processing')
        // Brief processing delay for UX, then show success
        await new Promise((r) => setTimeout(r, 600))
        setSuccessMessage(
          t === 'CASH'
            ? 'Order placed! Please hand the cash to your waiter.'
            : t === 'COUNTER'
              ? 'Order placed! Please pay at the billing counter.'
              : 'Order placed! You can settle the bill before leaving.',
        )
        setStep('success')
        toast.success(successMessage, { duration: 4000 })
        return
      }

      // Online flow (UPI / QR / CARD / WALLET / NETBANKING / CUSTOM)
      setStep('processing')
      const apiMethod = t === 'QR' ? 'UPI' : t
      const init = await initiate.mutateAsync({
        orderId,
        method: apiMethod as any,
        paymentMethodId: selectedMethod.id,
      })

      setUpiDeepLink(init.upiDeepLink || null)
      setUpiQrPayload(init.upiQrPayload || null)
      setUpiId(init.upiId || null)

      // UPI: open the deep-link (auto-launch customer's UPI app), then wait
      // for them to return + verify.
      if (t === 'UPI' && init.upiDeepLink) {
        const tableToken = new URLSearchParams(window.location.search).get('table') || ''
        sessionStorage.setItem(`order-${tableToken}`, orderId)
        sessionStorage.setItem('returning-from-upi', '1')
        try {
          window.open(init.upiDeepLink, '_blank')
        } catch {
          // popup blocked — fall through to the manual "Open UPI app" button
        }
        setStep('upi_launch')
        await new Promise((r) => setTimeout(r, init.verifyInMs || 3000))
        await verify.mutateAsync({
          paymentId: init.paymentId,
          providerTxnId: init.providerTxnId,
        })
        setSuccessMessage('Payment successful! Your order is confirmed.')
        setStep('success')
        return
      }

      // QR: show the QR + UPI ID, wait for the customer to scan + pay, then verify
      if (t === 'QR' && init.upiQrPayload) {
        setStep('qr')
        await new Promise((r) => setTimeout(r, init.verifyInMs || 3000))
        await verify.mutateAsync({
          paymentId: init.paymentId,
          providerTxnId: init.providerTxnId,
        })
        setSuccessMessage('Payment successful! Your order is confirmed.')
        setStep('success')
        return
      }

      // CARD / WALLET / NETBANKING / CUSTOM: mock wait, then verify
      await new Promise((r) => setTimeout(r, init.verifyInMs || 1500))
      await verify.mutateAsync({
        paymentId: init.paymentId,
        providerTxnId: init.providerTxnId,
      })
      setSuccessMessage('Payment successful! Your order is confirmed.')
      setStep('success')
    } catch (err: any) {
      // CRITICAL: do NOT silently reset to 'method'. If the order was already
      // placed, the customer has a placed order in the system — we MUST route
      // them to the tracking page (or give them an explicit way to retry).
      //
      // - If placedOrderId is set (order was created in this sheet OR the sheet
      //   was opened in existing-order mode) → go to 'error' step which offers
      //   "Track order" + "Try again" so they're never stuck.
      // - Otherwise (e.g. placeOrder itself failed) → back to 'method' so they
      //   can retry selecting a method, but still surface the error.
      const msg = err?.message || 'Payment failed. Please try again.'
      setErrorMessage(msg)
      if (placedOrderId) {
        setStep('error')
      } else {
        setStep('method')
      }
      toast.error(msg)
    }
  }

  // Auto-redirect to order tracking after success. Pass the customerPhone
  // up to the parent so it can fetch ALL active orders for that mobile.
  useEffect(() => {
    if (step === 'success' && placedOrderId) {
      const t = setTimeout(() => {
        onCheckoutComplete(placedOrderId, customerPhone || undefined)
      }, 1800)
      return () => clearTimeout(t)
    }
  }, [step, placedOrderId, onCheckoutComplete, customerPhone])

  // Manual redirect from the error step → route to tracking page
  const goToTracking = () => {
    if (placedOrderId) {
      onCheckoutComplete(placedOrderId, customerPhone || undefined)
    }
  }

  // Retry payment on the SAME order (clears the failed attempt and lets the
  // customer pick a different method or retry the same one). We keep
  // placedOrderId intact so `ensureOrderPlaced()` returns the existing order.
  const retryPayment = () => {
    setErrorMessage('')
    setSelectedMethod(null)
    setUpiDeepLink(null)
    setUpiQrPayload(null)
    setUpiId(null)
    setStep('method')
  }

  const canPay = !!selectedMethod && (skipCustomerDetails || formValid) && !placeOrder.isPending

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        // Block close during processing + success (auto-redirect in flight)
        if (step === 'processing' || step === 'success') return
        // If the customer tries to close the sheet during the 'error' step
        // AND the order was placed, route them to the tracking page instead
        // of just dismissing — they have an order in the system that they
        // need to be able to track. Only fall through to a normal close if
        // there's no placed order (e.g. the initial placeOrder call itself
        // failed, so there's nothing to track).
        if (!o && step === 'error' && placedOrderId) {
          onCheckoutComplete(placedOrderId)
          return
        }
        onOpenChange(o)
      }}
    >
      <SheetContent
        side="bottom"
        className="flex max-h-[94vh] flex-col gap-0 rounded-t-3xl border-slate-200 bg-white p-0"
      >
        {/* Drag handle */}
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />

        {/* Header — varies by step */}
        <SheetHeader className="border-b border-slate-100 px-5 pb-3 pt-3">
          <div className="flex items-center gap-2">
            {step === 'method' && !skipCustomerDetails && (
              <button
                onClick={() => setStep('details')}
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <SheetTitle className="text-left text-[16px] font-bold text-slate-900">
              {stepTitle(step)}
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            {stepDescription(step)}
          </SheetDescription>
        </SheetHeader>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            {/* Step 1: Customer details */}
            {step === 'details' && (
              <motion.div
                key="details"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="space-y-4"
              >
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-slate-500">Paying to</span>
                    <span className="font-semibold text-slate-800">{restaurant.name}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[13px]">
                    <span className="text-slate-500">Amount</span>
                    <span className="text-lg font-extrabold text-slate-900">{totalDisplay}</span>
                  </div>
                </div>

                {initialCustomerName && (
                  <div className="flex items-center gap-2 rounded-xl bg-orange-50 p-2.5 text-[11.5px] text-orange-700">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span>
                      Re-using your name &amp; mobile from your previous order —
                      tap Continue to place this as a fresh new order.
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-name" className="text-[13px] font-semibold text-slate-700">
                      Your name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="cs-name"
                      placeholder="e.g. Arjun Patel"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      maxLength={80}
                      autoFocus
                      aria-invalid={touched && !nameValid}
                      className="h-11 rounded-xl border-slate-200 text-[14px] focus-visible:ring-orange-400"
                    />
                    {touched && !nameValid && (
                      <p className="text-[11px] text-red-500">Please enter your name (min 2 characters).</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cs-phone" className="text-[13px] font-semibold text-slate-700">
                      Phone number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="cs-phone"
                      inputMode="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      maxLength={20}
                      aria-invalid={touched && !phoneValid}
                      className="h-11 rounded-xl border-slate-200 text-[14px] focus-visible:ring-orange-400"
                    />
                    {touched && !phoneValid && (
                      <p className="text-[11px] text-red-500">Please enter a valid phone number (7–15 digits).</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-[11px] text-emerald-700">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>Your details are shared only with the restaurant to fulfil your order.</span>
                </div>
              </motion.div>
            )}

            {/* Step 2: Payment method picker */}
            {step === 'method' && (
              <motion.div
                key="method"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="space-y-4"
              >
                {/* Order summary */}
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-slate-500">Item total ({totals.itemCount})</span>
                    <span className="font-semibold text-slate-700">₹{totals.subtotal.toFixed(0)}</span>
                  </div>
                  {totals.taxAmount > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[13px]">
                      <span className="text-slate-500">Taxes & GST</span>
                      <span className="font-semibold text-slate-700">₹{totals.taxAmount.toFixed(0)}</span>
                    </div>
                  )}
                  {totals.serviceCharge > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[13px]">
                      <span className="text-slate-500">Service charge</span>
                      <span className="font-semibold text-slate-700">₹{totals.serviceCharge.toFixed(0)}</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-bold text-slate-900">To pay</span>
                    <span className="text-[16px] font-extrabold text-slate-900">{totalDisplay}</span>
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block text-[13px] font-semibold text-slate-700">
                    Choose a payment method
                  </Label>
                  <PaymentMethodPicker
                    methods={availableMethods}
                    onSelect={(m) => setSelectedMethod(m)}
                    disabled={false}
                    recommendFirst
                    selectedMethodId={selectedMethod?.id || null}
                    hiddenMethodIds={hiddenMethodIds}
                  />
                  {availableMethods.length === 0 && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
                      No payment methods configured for this restaurant yet.
                      Please ask the staff for assistance.
                    </p>
                  )}
                </div>

                {/* Selected method summary */}
                {selectedMethod && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between rounded-lg bg-orange-50 p-2.5 text-[12px]"
                  >
                    <span className="text-slate-600">Paying with</span>
                    <span className="font-semibold text-orange-700">{selectedMethod.label}</span>
                  </motion.div>
                )}

                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Lock className="h-3 w-3" />
                  <span>Payments are encrypted and processed securely.</span>
                </div>
              </motion.div>
            )}

            {/* Step: UPI launch (waiting for customer to return from UPI app) */}
            {step === 'upi_launch' && (
              <motion.div
                key="upi_launch"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3 py-6 text-center"
              >
                <Smartphone className="h-12 w-12 text-orange-500" />
                <p className="text-[14px] font-semibold text-slate-800">
                  Waiting for payment…
                </p>
                <p className="px-6 text-[12px] text-slate-500">
                  Your UPI app should have opened. Approve the payment of
                  <strong className="text-slate-900"> {totalDisplay}</strong> there, and we&apos;ll confirm automatically.
                </p>
                {upiDeepLink && (
                  <Button
                    onClick={() => window.open(upiDeepLink, '_blank')}
                    variant="outline"
                    size="sm"
                    className="mt-2 rounded-xl"
                  >
                    Re-open UPI app
                  </Button>
                )}
                {upiId && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                    <span className="text-slate-400">UPI ID:</span>
                    <code className="font-mono text-slate-700">{upiId}</code>
                    <button
                      onClick={() => {
                        if (upiId) {
                          navigator.clipboard.writeText(upiId)
                          toast.success('UPI ID copied')
                        }
                      }}
                      className="text-orange-500 hover:underline"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming payment…
                </div>
              </motion.div>
            )}

            {/* Step: QR */}
            {step === 'qr' && upiQrPayload && (
              <motion.div
                key="qr"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3 py-4 text-center"
              >
                <p className="text-[13px] text-slate-600">
                  Scan this QR with any UPI app to pay
                  <strong className="text-slate-900"> {totalDisplay}</strong>
                </p>
                <div className="rounded-2xl border-2 border-slate-100 bg-white p-4 shadow-sm">
                  <QrCodeDisplay payload={upiQrPayload} />
                </div>
                {upiId && (
                  <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                    <span className="text-slate-400">UPI ID:</span>
                    <code className="font-mono text-slate-700">{upiId}</code>
                    <button
                      onClick={() => {
                        if (upiId) {
                          navigator.clipboard.writeText(upiId)
                          toast.success('UPI ID copied')
                        }
                      }}
                      className="text-orange-500 hover:underline"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for payment confirmation…
                </div>
              </motion.div>
            )}

            {/* Step: Generic processing (CARD / WALLET / NETBANKING / CASH) */}
            {step === 'processing' && !['upi_launch', 'qr'].includes(step) && (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3 py-10 text-center"
              >
                {selectedMethod && (() => {
                  const Icon = ICON_FOR_METHOD[selectedMethod.type] || Smartphone
                  return <Icon className="h-12 w-12 text-orange-500" />
                })()}
                <p className="text-[14px] font-semibold text-slate-800">
                  {selectedMethod?.type === 'CASH'
                    ? 'Placing your order…'
                    : selectedMethod?.type === 'COUNTER'
                      ? 'Placing your order…'
                      : selectedMethod?.type === 'PAY_LATER'
                        ? 'Placing your order…'
                        : 'Processing payment…'}
                </p>
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </motion.div>
            )}

            {/* Step: Success */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 py-10 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50"
                >
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </motion.div>
                <p className="text-[15px] font-bold text-slate-900">All done!</p>
                <p className="px-6 text-[13px] text-slate-500">
                  {successMessage || 'Your order is confirmed.'}
                </p>
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                <p className="text-[11px] text-slate-400">Redirecting to order tracking…</p>
              </motion.div>
            )}

            {/* Step: Error — order placed but payment failed.
                Give the customer an explicit way to either retry or go to
                the tracking page. This is the fix for the bug where the
                tracking page wouldn't load after a payment error. */}
            {step === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4 px-2 py-8 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50"
                >
                  <AlertCircle className="h-8 w-8 text-amber-600" />
                </motion.div>
                <div className="space-y-1">
                  <p className="text-[15px] font-bold text-slate-900">
                    Payment couldn&apos;t be completed
                  </p>
                  <p className="px-4 text-[12px] text-slate-500">
                    {errorMessage
                      ? `Reason: ${errorMessage}`
                      : 'Something went wrong while processing your payment.'}
                  </p>
                </div>

                {/* Reassurance: only show in initial-placement mode. In
                    existing-order mode the customer already knew the order
                    existed — they just wanted to pay for it. */}
                {!existingOrderId && (
                  <div className="w-full rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-left">
                    <p className="text-[12px] font-semibold text-emerald-800">
                      Good news: your order was placed.
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-700">
                      It&apos;s in the kitchen queue. You can retry payment now or
                      settle it later from the tracking page.
                    </p>
                  </div>
                )}

                {/* Actions — primary = retry, secondary = go to tracking (or close in existing-order mode) */}
                <div className="flex w-full flex-col gap-2">
                  <Button
                    size="lg"
                    className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99]"
                    onClick={retryPayment}
                  >
                    Try a different payment method
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-11 w-full rounded-xl border-slate-300 text-[14px] font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      // In existing-order mode (bill-view / order-tracking),
                      // "go to tracking" doesn't apply — just close the sheet
                      // and refetch so the parent UI reflects the failed state.
                      if (existingOrderId) {
                        onCheckoutComplete(placedOrderId || existingOrderId)
                      } else {
                        goToTracking()
                      }
                    }}
                  >
                    {existingOrderId ? 'Close' : 'Go to order tracking'}
                    {!existingOrderId && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                </div>

                <p className="text-[11px] text-slate-400">
                  You can also pay later from the tracking page or by asking the waiter.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer — sticky CTA (only on details + method steps) */}
        {(step === 'details' || step === 'method') && (
          <div className="border-t border-slate-100 bg-white px-5 py-3 pb-6">
            {step === 'details' && (
              <Button
                size="lg"
                className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99]"
                disabled={!formValid}
                onClick={() => {
                  setTouched(true)
                  if (formValid) setStep('method')
                }}
              >
                Continue to payment · {totalDisplay}
              </Button>
            )}
            {step === 'method' && (
              <Button
                size="lg"
                className="h-12 w-full rounded-xl bg-orange-600 text-[15px] font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:bg-orange-700 active:scale-[0.99] disabled:opacity-50"
                disabled={!canPay}
                onClick={handlePay}
              >
                {placeOrder.isPending || initiate.isPending
                  ? 'Placing order…'
                  : `Pay ${totalDisplay}`}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function stepTitle(step: Step): string {
  switch (step) {
    case 'details':
      return 'Checkout'
    case 'method':
      return 'Choose payment'
    case 'upi_launch':
      return 'Pay via UPI'
    case 'qr':
      return 'Scan to pay'
    case 'processing':
      return 'Processing'
    case 'success':
      return 'Order placed!'
    case 'error':
      return 'Payment failed'
  }
}

function stepDescription(step: Step): string {
  return stepTitle(step)
}

/** Render a QR data URL via the lazy-loaded qrcode lib. */
function QrCodeDisplay({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(payload, {
          width: 256,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        }),
      )
      .then((url: string) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [payload])

  if (error) {
    return (
      <div className="flex h-48 w-48 items-center justify-center text-center text-xs text-red-500">
        Failed to generate QR code.
        <br />
        Please use the UPI ID directly.
      </div>
    )
  }
  if (!dataUrl) {
    return (
      <div className="flex h-48 w-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
      </div>
    )
  }
  return <img src={dataUrl} alt="UPI payment QR code" className="h-48 w-48" />
}
