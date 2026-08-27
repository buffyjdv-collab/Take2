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
import { Minus, Plus, Trash2, ShoppingBag, Smartphone, QrCode, Banknote, Loader2, CheckCircle2, Copy, ChevronRight, User, Phone } from 'lucide-react'
import { PaymentMethodPicker, filterAvailableForCheckout } from './payment-method-picker'
import type { PaymentMethodT } from './types'
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

type PaymentMethod = 'UPI' | 'QR' | 'CASH' | 'CARD' | 'WALLET' | 'NETBANKING' | 'COUNTER' | 'PAY_LATER' | 'CUSTOM' | null

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

  const requirePrePayment =
    restaurant.settings?.allowPrePayment && restaurant.settings?.requirePrePayment

  const nameValid = customerName.trim().length >= 2
  const digits = customerPhone.replace(/[^\d]/g, '')
  const phoneValid = digits.length >= 7 && digits.length <= 15
  const formValid = nameValid && phoneValid

  // Reset state when dialog closes
  useEffect(() => {
    if (!confirmOpen) {
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

  const handlePlaceOrder = async (method: PaymentMethodT | null) => {
    setTouched(true)
    if (!formValid) {
      toast.error('Please enter your name and phone number to place the order.')
      return
    }
    if (!method) {
      toast.error('Please choose a payment method.')
      return
    }

    const t = method.type as any
    setSelectedMethod(t)
    setPaymentStep('processing')

    try {
      const idempotencyKey =
        sessionStorage.getItem('last-idem-key') ||
        `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
      sessionStorage.setItem('last-idem-key', idempotencyKey)

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

      // Cash / Counter / Pay-Later: no online payment initiated.
      // Waiter / counter staff mark the order as paid later.
      if (t === 'CASH' || t === 'COUNTER' || t === 'PAY_LATER') {
        setPaymentStep('done')
        const msg =
          t === 'CASH'
            ? 'Order placed! Please hand the cash to your waiter.'
            : t === 'COUNTER'
              ? 'Order placed! Please pay at the billing counter.'
              : 'Order placed! You can settle the bill before leaving.'
        toast.success(msg, {
          description: 'Your order will be confirmed once staff marks it as paid.',
          duration: 6000,
        })
        setTimeout(() => {
          clear()
          setCustomerName('')
          setCustomerPhone('')
          setTouched(false)
          setConfirmOpen(false)
          onCheckout(order.id)
        }, 2500)
      } else if (t === 'UPI' || t === 'QR' || t === 'CARD' || t === 'WALLET' || t === 'NETBANKING' || t === 'CUSTOM') {
        try {
          // UPI/QR go through the UPI deep-link flow; everything else (CARD /
          // WALLET / NETBANKING / CUSTOM) goes through the mock verify flow.
          const apiMethod = t === 'QR' ? 'UPI' : t
          const init = await initiate.mutateAsync({
            orderId: order.id,
            method: apiMethod as any,
            paymentMethodId: method.id,
          })
          setUpiDeepLink(init.upiDeepLink || null)
          setUpiQrPayload(init.upiQrPayload || null)
          setUpiId(init.upiId || null)

          // UPI method (deep-link): try to open the customer's UPI app.
          if (t === 'UPI' && init.upiDeepLink) {
            const tableToken = new URLSearchParams(window.location.search).get('table') || ''
            sessionStorage.setItem(`order-${tableToken}`, order.id)
            sessionStorage.setItem('returning-from-upi', '1')
            window.open(init.upiDeepLink, '_blank')
            onCheckout(order.id)
            clear()
            setCustomerName('')
            setCustomerPhone('')
            setTouched(false)
            setConfirmOpen(false)
            return
          }

          // For QR / CARD / WALLET / NETBANKING / CUSTOM: wait briefly
          // then mark the payment as verified (mock).
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
          if (order?.id) {
            onCheckout(order.id)
            clear()
            setCustomerName('')
            setCustomerPhone('')
            setTouched(false)
            setConfirmOpen(false)
          }
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
                onClick={() => setConfirmOpen(true)}
              >
                Place order · ₹{t.grandTotal.toFixed(0)}
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>

      {/* Checkout dialog — name + phone + payment method */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (paymentStep !== 'processing') setConfirmOpen(o) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-left">
              {paymentStep === 'done'
                ? 'Order placed!'
                : requirePrePayment
                ? 'Checkout'
                : 'Confirm your order'}
            </DialogTitle>
          </DialogHeader>

          {paymentStep === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50"
              >
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </motion.div>
              <p className="text-sm text-slate-500">
                {selectedMethod === 'CASH'
                  ? 'Please hand the cash to your waiter. Your order will be confirmed shortly.'
                  : 'Payment received. Redirecting to order tracking…'}
              </p>
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'QR' && upiQrPayload ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-center text-sm text-slate-500">
                Scan this QR code with your UPI app to pay
                <strong className="text-slate-900"> ₹{t.grandTotal.toFixed(0)}</strong>
              </p>
              <div className="rounded-2xl border-2 border-slate-100 bg-white p-5">
                <QrCodeDisplay payload={upiQrPayload} />
              </div>
              {upiId && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-400">UPI ID:</span>
                  <code className="font-mono text-slate-700">{upiId}</code>
                  <button onClick={copyUpiId} className="text-orange-500 hover:underline">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for payment confirmation…
              </div>
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'UPI' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Smartphone className="h-12 w-12 text-orange-500" />
              <p className="text-sm font-medium text-slate-700">
                Your UPI app should have opened automatically.
              </p>
              <p className="text-xs text-slate-400">
                If it didn&apos;t open, tap the button below.
              </p>
              {upiDeepLink && (
                <Button
                  onClick={() => window.location.href = upiDeepLink}
                  className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"
                  size="sm"
                >
                  Open UPI app
                </Button>
              )}
              {upiId && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-400">UPI ID:</span>
                  <code className="font-mono text-slate-700">{upiId}</code>
                  <button onClick={copyUpiId} className="text-orange-500 hover:underline">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for payment confirmation…
              </div>
            </div>
          ) : paymentStep === 'processing' && selectedMethod === 'CASH' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Banknote className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium text-slate-700">Placing your order…</p>
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Name + Phone — Swiggy style minimal inputs */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customer-name" className="text-[13px] font-semibold text-slate-700">
                    Your name <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="customer-name"
                      placeholder="e.g. Arjun Patel"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      maxLength={80}
                      autoFocus
                      aria-invalid={touched && !nameValid}
                      className="h-11 rounded-xl border-slate-200 pl-9 text-[14px] focus-visible:ring-orange-400"
                    />
                  </div>
                  {touched && !nameValid && (
                    <p className="text-[11px] text-red-500">Please enter your name (min 2 characters).</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customer-phone" className="text-[13px] font-semibold text-slate-700">
                    Phone number <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="customer-phone"
                      inputMode="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      maxLength={20}
                      aria-invalid={touched && !phoneValid}
                      className="h-11 rounded-xl border-slate-200 pl-9 text-[14px] focus-visible:ring-orange-400"
                    />
                  </div>
                  {touched && !phoneValid && (
                    <p className="text-[11px] text-red-500">Please enter a valid phone number (7–15 digits).</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Payment method selection — Zepto-style configurable picker */}
              <div className="space-y-3">
                <Label className="text-[13px] font-semibold text-slate-700">
                  {requirePrePayment ? 'Choose payment method *' : 'Pay now (optional)'}
                </Label>
                {!requirePrePayment && (
                  <p className="text-[12px] text-slate-400">
                    You can pay now or after your order is served.
                  </p>
                )}
                <PaymentMethodPicker
                  methods={filterAvailableForCheckout(restaurant.paymentMethods)}
                  onSelect={(m) => handlePlaceOrder(m)}
                  disabled={paymentStep === 'processing' || !formValid}
                  recommendFirst
                />
                {(!restaurant.paymentMethods ||
                  restaurant.paymentMethods.length === 0) && (
                  <p className="text-[11px] text-slate-400">
                    No payment methods configured yet — please ask the staff for assistance.
                  </p>
                )}
              </div>
            </div>
          )}

          {paymentStep !== 'processing' && paymentStep !== 'done' && (
            <DialogFooter>
              <Button
                variant="ghost"
                className="text-slate-500 hover:text-slate-700"
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
    return () => { cancelled = true }
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
