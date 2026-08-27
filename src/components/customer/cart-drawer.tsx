'use client'

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Minus, Plus, Trash2, ShoppingBag, Smartphone, QrCode, Banknote, Loader2, CheckCircle2, Copy } from 'lucide-react'
import { useCustomerCart, lineKeyOf } from '@/stores/customer-cart'
import { Price } from '@/components/restaurant/price'
import { VegBadge } from '@/components/restaurant/veg-badge'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/restaurant/loading-states'
import { useState, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { usePlaceOrder, useInitiatePayment, useVerifyPayment, api } from '@/hooks/api'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import type { RestaurantInfo } from './types'
import type { CartItem } from '@/lib/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurant: RestaurantInfo
  onCheckout: (orderId: string) => void
}

type PaymentMethod = 'UPI' | 'QR' | 'CASH' | null

export function CartDrawer({ open, onOpenChange, restaurant, onCheckout }: Props) {
  const items = useCustomerCart((s) => s.items)
  const updateQuantity = useCustomerCart((s) => s.updateQuantity)
  const removeItem = useCustomerCart((s) => s.removeItem)
  const clear = useCustomerCart((s) => s.clear)
  const totals = useCustomerCart((s) => s.totals)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [touched, setTouched] = useState(false)
  const placeOrder = usePlaceOrder()

  // Payment flow state
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(null)
  const [paymentStep, setPaymentStep] = useState<'idle' | 'processing' | 'done'>('idle')
  const [upiDeepLink, setUpiDeepLink] = useState<string | null>(null)
  const [upiQrPayload, setUpiQrPayload] = useState<string | null>(null)
  const [upiId, setUpiId] = useState<string | null>(null)
  const initiate = useInitiatePayment()
  const verify = useVerifyPayment()

  const t = totals(restaurant.taxRate, restaurant.serviceChargeRate)

  // Determine if pre-payment is required (from restaurant settings)
  const requirePrePayment =
    restaurant.settings?.allowPrePayment && restaurant.settings?.requirePrePayment

  const nameValid = customerName.trim().length >= 2
  const digits = customerPhone.replace(/[^\d]/g, '')
  const phoneValid = digits.length >= 7 && digits.length <= 15
  const formValid = nameValid && phoneValid

  // Reset state when dialog closes
  useEffect(() => {
    if (!confirmOpen) {
      // Small delay so the exit animation completes before resetting
      const timer = setTimeout(() => {
        if (paymentStep !== 'processing') {
          setSelectedMethod(null)
          setPaymentStep('idle')
          setUpiDeepLink(null)
          setUpiQrPayload(null)
          setUpiId(null)
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [confirmOpen, paymentStep])

  // Step 1: Place the order (creates a PENDING_PAYMENT order if requirePrePayment is on)
  const handlePlaceOrder = async (method: PaymentMethod) => {
    setTouched(true)
    if (!formValid) {
      toast.error('Please enter your name and phone number to place the order.')
      return
    }
    if (!method) {
      toast.error('Please choose a payment method.')
      return
    }

    setSelectedMethod(method)
    setPaymentStep('processing')

    try {
      // Generate idempotency key
      const idempotencyKey =
        sessionStorage.getItem('last-idem-key') ||
        `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
      sessionStorage.setItem('last-idem-key', idempotencyKey)

      // Place the order
      const body = {
        tableToken:
          new URLSearchParams(window.location.search).get('table') || '',
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
      }
      const order = await placeOrder.mutateAsync(body)
      sessionStorage.removeItem('last-idem-key')
      setPlacedOrderId(order.id)

      // Now handle payment based on the selected method
      if (method === 'CASH') {
        // For cash: the order is placed as PENDING_PAYMENT. The customer hands
        // cash to the waiter, who marks it paid from the orders module. No
        // online payment is initiated.
        setPaymentStep('done')
        toast.success('Order placed! Please hand the cash to your waiter.', {
          description: 'Your order will be confirmed once the waiter marks it as paid.',
          duration: 6000,
        })
        // Clear cart + close dialog after a short delay
        setTimeout(() => {
          clear()
          setCustomerName('')
          setCustomerPhone('')
          setTouched(false)
          setConfirmOpen(false)
          onCheckout(order.id)
        }, 2500)
      } else if (method === 'UPI' || method === 'QR') {
        // For UPI / Scan QR: initiate the payment, get the deep link + QR payload
        try {
          const init = await initiate.mutateAsync({ orderId: order.id, method: 'UPI' })
          setUpiDeepLink(init.upiDeepLink || null)
          setUpiQrPayload(init.upiQrPayload || null)
          setUpiId(init.upiId || null)

          // For UPI method: save order to sessionStorage and set a flag
          // BEFORE redirecting to the UPI app. When the customer returns,
          // customer-app will detect the flag and auto-show the tracking page.
          if (method === 'UPI' && init.upiDeepLink) {
            const tableToken = new URLSearchParams(window.location.search).get('table') || ''
            sessionStorage.setItem(`order-${tableToken}`, order.id)
            sessionStorage.setItem('returning-from-upi', '1')
            window.location.href = init.upiDeepLink
            return // stop execution — page is navigating away
          }

          // For QR method: the QR code is displayed in the dialog (no auto-redirect)
          // The customer scans it with their UPI app

          // Simulate payment verification after a delay (in production this would
          // be a webhook or poll loop checking the payment status)
          await new Promise((r) => setTimeout(r, init.verifyInMs || 3000))
          await verify.mutateAsync({
            paymentId: init.paymentId,
            providerTxnId: init.providerTxnId,
          })
          setPaymentStep('done')
          toast.success('Payment successful! Your order is confirmed.', {
            duration: 5000,
          })
          setTimeout(() => {
            clear()
            setCustomerName('')
            setCustomerPhone('')
            setTouched(false)
            setConfirmOpen(false)
            onCheckout(order.id)
          }, 2000)
        } catch (payErr: any) {
          setPaymentStep('idle')
          setSelectedMethod(null)
          toast.error(payErr.message || 'Payment failed. Please try again.')
        }
      }
    } catch (err: any) {
      setPaymentStep('idle')
      setSelectedMethod(null)
      toast.error(err.message || 'Failed to place order')
    }
  }

  const copyUpiId = () => {
    if (upiId) {
      navigator.clipboard.writeText(upiId)
      toast.success('UPI ID copied')
    }
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="border-b pb-3">
            <DrawerTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-orange-600" />
              Your cart
              {items.length > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  {t.itemCount}
                </span>
              )}
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
              <div className="max-h-[44vh] space-y-2 overflow-y-auto px-3 py-3">
                {items.map((item) => {
                  const key = lineKeyOf(item)
                  return (
                    <div
                      key={key}
                      className="flex gap-3 rounded-xl border border-slate-100 p-2.5"
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-orange-50">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xl">
                            🍽️
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1.5">
                          <VegBadge isVeg={item.isVeg} />
                          <p className="line-clamp-1 flex-1 text-sm font-semibold">
                            {item.name}
                          </p>
                          <button
                            onClick={() => removeItem(key)}
                            className="text-muted-foreground hover:text-red-600"
                            aria-label="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        {item.variantName && (
                          <p className="text-xs text-muted-foreground">
                            Size: {item.variantName}
                          </p>
                        )}
                        {item.modifierNames.length > 0 && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {item.modifierNames.join(', ')}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-xs italic text-muted-foreground">
                            “{item.notes}”
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between">
                          <Price amount={item.totalPrice} size="sm" />
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() =>
                                updateQuantity(key, item.quantity - 1)
                              }
                              aria-label="Decrease quantity"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-5 text-center text-sm font-semibold">
                              {item.quantity}
                            </span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() =>
                                updateQuantity(key, item.quantity + 1)
                              }
                              aria-label="Increase quantity"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="border-t bg-slate-50 px-4 py-3">
                <div className="space-y-1 text-sm">
                  <Row label="Subtotal" value={t.subtotal} />
                  {restaurant.taxRate > 0 && (
                    <Row
                      label={`Taxes & GST (${(restaurant.taxRate * 100).toFixed(1)}%)`}
                      value={t.taxAmount}
                    />
                  )}
                  {restaurant.serviceChargeRate > 0 && (
                    <Row
                      label={`Service charge (${(restaurant.serviceChargeRate * 100).toFixed(0)}%)`}
                      value={t.serviceCharge}
                    />
                  )}
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between text-base font-bold">
                    <span>Total</span>
                    <Price amount={t.grandTotal} size="lg" />
                  </div>
                </div>
              </div>
            </>
          )}

          {items.length > 0 && (
            <DrawerFooter className="border-t bg-white px-4 pt-3">
              <Button
                size="lg"
                className="bg-orange-600 text-white hover:bg-orange-700"
                onClick={() => setConfirmOpen(true)}
              >
                Place order · ₹{t.grandTotal.toFixed(0)}
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>

      {/* Checkout dialog — name + phone + payment method selection */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (paymentStep !== 'processing') setConfirmOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {paymentStep === 'done'
                ? 'Order confirmed!'
                : requirePrePayment
                ? 'Checkout'
                : 'Your details'}
            </DialogTitle>
          </DialogHeader>

          {/* Payment done — success screen */}
          {paymentStep === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"
              >
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </motion.div>
              <p className="text-sm text-muted-foreground">
                {selectedMethod === 'CASH'
                  ? 'Please hand the cash to your waiter. Your order will be confirmed shortly.'
                  : 'Payment received. Redirecting to order tracking…'}
              </p>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'QR' && upiQrPayload ? (
            /* QR code display — for "Scan QR" payment method */
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-sm text-muted-foreground text-center">
                Scan this QR code with your UPI app (GPay / PhonePe / Paytm) to pay
                <strong> ₹{t.grandTotal.toFixed(0)}</strong>
              </p>
              <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
                <QrCodeDisplay payload={upiQrPayload} />
              </div>
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for payment confirmation…
              </div>
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'UPI' ? (
            /* UPI deep link launched — waiting for payment */
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Smartphone className="h-12 w-12 text-orange-600" />
              <p className="text-sm font-medium">
                Your UPI app should have opened automatically.
              </p>
              <p className="text-xs text-muted-foreground">
                If it didn&apos;t open, tap the button below to launch it manually.
              </p>
              {upiDeepLink && (
                <Button
                  onClick={() => window.location.href = upiDeepLink}
                  className="bg-orange-600 text-white hover:bg-orange-700"
                  size="sm"
                >
                  Open UPI app
                </Button>
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for payment confirmation…
              </div>
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'CASH' ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Banknote className="h-12 w-12 text-emerald-600" />
              <p className="text-sm font-medium">
                Placing your order…
              </p>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            /* Default: name + phone + payment method selection */
            <div className="space-y-4">
              {/* Name + Phone inputs */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customer-name">Your name *</Label>
                  <Input
                    id="customer-name"
                    placeholder="e.g. Arjun Patel"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    maxLength={80}
                    autoFocus
                    aria-invalid={touched && !nameValid}
                  />
                  {touched && !nameValid && (
                    <p className="text-xs text-red-600">
                      Please enter your name (min 2 characters).
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customer-phone">Phone number *</Label>
                  <Input
                    id="customer-phone"
                    inputMode="tel"
                    placeholder="e.g. +91 98765 43210"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    maxLength={20}
                    aria-invalid={touched && !phoneValid}
                  />
                  {touched && !phoneValid && (
                    <p className="text-xs text-red-600">
                      Please enter a valid phone number (7–15 digits).
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Payment method selection — selecting a method starts the flow */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {requirePrePayment
                    ? 'Choose payment method *'
                    : 'Pay now (optional)'}
                </Label>
                {!requirePrePayment && (
                  <p className="text-xs text-muted-foreground">
                    You can pay now or after your order is served.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {/* UPI */}
                  <button
                    onClick={() => handlePlaceOrder('UPI')}
                    disabled={paymentStep === 'processing' || !formValid || !restaurant.upiId}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-orange-400 hover:bg-orange-50/40 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                      <Smartphone className="h-5 w-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Pay by UPI</p>
                      <p className="text-xs text-muted-foreground">
                        {restaurant.upiId
                          ? `Pay to ${restaurant.upiId}`
                          : 'Not configured — choose another method'}
                      </p>
                    </div>
                  </button>

                  {/* Scan QR */}
                  <button
                    onClick={() => handlePlaceOrder('QR')}
                    disabled={paymentStep === 'processing' || !formValid || !restaurant.upiId}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-orange-400 hover:bg-orange-50/40 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                      <QrCode className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Scan QR code</p>
                      <p className="text-xs text-muted-foreground">
                        {restaurant.upiId
                          ? 'Scan with GPay / PhonePe / Paytm'
                          : 'Not configured — choose another method'}
                      </p>
                    </div>
                  </button>

                  {/* Cash */}
                  <button
                    onClick={() => handlePlaceOrder('CASH')}
                    disabled={paymentStep === 'processing' || !formValid}
                    className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-emerald-400 hover:bg-emerald-50/40 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                      <Banknote className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Pay in cash</p>
                      <p className="text-xs text-muted-foreground">
                        Hand cash to your waiter — they&apos;ll mark it paid
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer — only show Cancel when not processing */}
          {paymentStep !== 'processing' && paymentStep !== 'done' && (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
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
        <br />
        Please use the UPI ID directly.
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

  return (
    <img
      src={dataUrl}
      alt="UPI payment QR code"
      className="h-48 w-48"
    />
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-slate-700">
        ₹{value.toFixed(0)}
      </span>
    </div>
  )
}
