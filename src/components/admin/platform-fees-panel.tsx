'use client'

/**
 * PlatformFeesPanel
 *
 * Shown inside the admin Settings → "Platform fees" tab. Lets the tenant
 * (restaurant owner / manager) see:
 *
 *   - Outstanding platform fees summary card (₹ X pending, Y fees, oldest
 *     date, overdue / blocked warning if applicable)
 *   - Active payment requests from the super admin ("Please pay ₹ X by Y")
 *   - Recent payment history (last 20 payments with method / status /
 *     fees covered / date)
 *   - "Pay now" button → opens a Sheet with the platform's configured
 *     payment methods (UPI / Card / Wallet / Net Banking / QR). Tapping a
 *     method initiates a platform-fee payment, then verifies it after a
 *     short mock delay, then refreshes the summary in real-time.
 *
 * Real-time:
 *   - `platform:feeRequested` → toast + refetch (admin just sent a new req)
 *   - `platform:feePaid`      → refetch (lump sum payment completed)
 *   - `platform:feeCollected` → refetch (per-fee collected — could be
 *                               the result of an admin manual collect)
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  AlertTriangle,
  Loader2,
  Wallet,
  CheckCircle2,
  Clock3,
  Smartphone,
  QrCode,
  CreditCard,
  Building2,
  ChevronRight,
  ArrowRightCircle,
  Ban,
} from 'lucide-react'
import { type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { formatINR, formatRelative } from '@/lib/format'
import { useSocketEvent } from '@/hooks/use-socket'

// ---------------------------------------------------------------------------
// Types — mirrors the GET /api/admin/platform-fees response shape
// ---------------------------------------------------------------------------

interface PlatformFeeSummary {
  restaurant: {
    id: string
    name: string
    plan: string
    platformFeeBlocked: boolean
    platformFeeBlockedAt: string | null
    platformFeeBlockReason: string | null
  }
  outstanding: number
  pendingCount: number
  oldestPendingDate: string | null
  isOverdue: boolean
  isBlocked: boolean
  lastPayment: {
    id: string
    amount: number
    method: string
    status: string
    paidAt: string | null
  } | null
  recentPayments: Array<{
    id: string
    amount: number
    method: string
    status: string
    provider: string | null
    note: string | null
    verifiedAt: string | null
    createdAt: string
    feesCovered: number
    request: { id: string; amount: number; status: string } | null
  }>
  activeRequests: Array<{
    id: string
    amount: number
    amountPaid: number
    status: string
    dueDate: string | null
    note: string | null
    sentAt: string
  }>
  totals: {
    lifetime: number
    collected: number
    pending: number
  }
}

interface PlatformPaymentMethodT {
  id: string
  type: string
  label: string
  description: string | null
  icon: string | null
  accentColor: string
  priority: number
  active: boolean
  config: Record<string, unknown>
}

const ICON_MAP: Record<string, LucideIcon> = {
  Smartphone,
  QrCode,
  CreditCard,
  Wallet,
  Building2,
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchSummary(): Promise<PlatformFeeSummary> {
  const res = await fetch('/api/admin/platform-fees', { cache: 'no-store' })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || 'Failed to load platform fee summary')
  }
  const json = await res.json()
  return json.data
}

async function fetchMethods(): Promise<PlatformPaymentMethodT[]> {
  const res = await fetch('/api/platform/fee-payment-methods', { cache: 'no-store' })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || 'Failed to load payment methods')
  }
  const json = await res.json()
  return json.data
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlatformFeesPanel() {
  const qc = useQueryClient()
  const [payOpen, setPayOpen] = useState(false)
  const [payingMethod, setPayingMethod] = useState<PlatformPaymentMethodT | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<string | undefined>(undefined)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-platform-fees'],
    queryFn: fetchSummary,
    refetchInterval: 30_000,
  })

  const { data: methods } = useQuery({
    queryKey: ['platform-payment-methods'],
    queryFn: fetchMethods,
  })

  // ---------------------- Realtime subscriptions ----------------------

  useSocketEvent<{ requestId: string; amount: number; note?: string }>(
    'platform:feeRequested',
    (payload) => {
      toast.info('Platform fee payment requested', {
        description: `${formatINR(payload.amount)} — ${payload.note || 'no note'}`,
      })
      qc.invalidateQueries({ queryKey: ['admin-platform-fees'] })
    },
  )

  useSocketEvent<{ paymentId: string; amount: number; status: string }>(
    'platform:feePaid',
    (payload) => {
      if (payload.status === 'PAID' || payload.status === 'COLLECTED_DIRECT') {
        toast.success('Platform fee payment recorded', {
          description: `${formatINR(payload.amount)} collected`,
        })
      }
      qc.invalidateQueries({ queryKey: ['admin-platform-fees'] })
    },
  )

  useSocketEvent('platform:feeCollected', () => {
    // Per-fee collected — could be a manual admin collect. Just refetch.
    qc.invalidateQueries({ queryKey: ['admin-platform-fees'] })
  })

  // ---------------------- Pay-now mutation ----------------------

  const initiateMutation = useMutation({
    mutationFn: async ({
      method,
      paymentMethodId,
      amount,
      requestId,
    }: {
      method: string
      paymentMethodId?: string
      amount?: number
      requestId?: string
    }) => {
      const res = await fetch('/api/admin/platform-fees/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, paymentMethodId, amount, requestId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to initiate payment')
      }
      return res.json()
    },
    onSuccess: async (json) => {
      const data = json.data
      // For UPI/QR: open the deep link in a new tab (mobile) or show a toast
      if (data.upiDeepLink) {
        if (typeof window !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent)) {
          window.location.href = data.upiDeepLink
        } else {
          toast.success('UPI payment initiated', {
            description: 'Open the UPI app on your phone to scan / approve',
          })
        }
      }
      // Mock verification: wait verifyInMs (default 2s) then call verify
      const waitMs = data.verifyInMs || 2000
      toast.loading('Verifying payment…', { id: 'verify', duration: waitMs + 500 })
      setTimeout(async () => {
        try {
          const verifyRes = await fetch('/api/admin/platform-fees/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentId: data.paymentId,
              providerTxnId: data.providerTxnId,
            }),
          })
          if (!verifyRes.ok) {
            const j = await verifyRes.json().catch(() => ({}))
            throw new Error(j.error || 'Verification failed')
          }
          toast.success('Payment verified!', { id: 'verify' })
          qc.invalidateQueries({ queryKey: ['admin-platform-fees'] })
          setPayOpen(false)
          setPayingMethod(null)
        } catch (err: any) {
          toast.error(err.message || 'Verification failed', { id: 'verify' })
        }
      }, waitMs)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to initiate payment')
      setPayingMethod(null)
    },
  })

  // ---------------------- Render ----------------------

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-600">
          {error.message}
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      {/* ---------------- Outstanding summary card ---------------- */}
      <SummaryCard data={data} onPayNow={() => setPayOpen(true)} />

      {/* ---------------- Active payment requests ---------------- */}
      {data.activeRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Payment requests from platform admin
              <Badge variant="secondary" className="ml-1">
                {data.activeRequests.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.activeRequests.map((r) => {
              const remaining = Math.max(0, r.amount - r.amountPaid)
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {formatINR(r.amount)}
                      </span>
                      {r.amountPaid > 0 && (
                        <Badge variant="outline" className="text-amber-700">
                          {formatINR(r.amountPaid)} paid
                        </Badge>
                      )}
                      {r.status === 'PARTIALLY_PAID' && (
                        <Badge variant="outline">{r.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                      )}
                    </div>
                    {r.note && (
                      <p className="mt-1 text-sm text-slate-600">{r.note}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      Requested {formatRelative(r.sentAt)}
                      {r.dueDate && ` · due ${formatRelative(r.dueDate)}`}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setSelectedRequest(r.id)
                      setPayOpen(true)
                    }}
                    disabled={remaining < 0.01}
                  >
                    Pay {formatINR(remaining)}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ---------------- Recent payments ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentPayments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No payments yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentPayments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <MethodIcon type={p.method} />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatINR(p.amount)}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          · {p.feesCovered} fees covered
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.verifiedAt
                          ? `Paid ${formatRelative(p.verifiedAt)}`
                          : `Initiated ${formatRelative(p.createdAt)}`}
                        {p.request && ` · req #${p.request.id.slice(-6)}`}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Payment sheet ---------------- */}
      <Sheet open={payOpen} onOpenChange={(o) => { setPayOpen(o); if (!o) { setPayingMethod(null); setSelectedRequest(undefined) } }}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl p-0">
          <SheetHeader className="border-b border-slate-100 px-4 pb-3 pt-4">
            <SheetTitle className="text-left text-base">
              Pay platform fees
            </SheetTitle>
            <SheetDescription className="text-left">
              Choose a payment method to settle your outstanding platform fees
              {selectedRequest && ' (for the requested amount)'}.
            </SheetDescription>
          </SheetHeader>
          <div className="max-h-[70vh] overflow-y-auto p-3">
            {data.outstanding < 0.01 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                You have no pending platform fees to pay.
              </p>
            )}
            {data.outstanding >= 0.01 && (!methods || methods.length === 0) && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                The platform has not configured any payment methods yet.
              </p>
            )}
            {data.outstanding >= 0.01 && methods && methods.length > 0 && (
              <ul className="space-y-2">
                {methods.map((m) => {
                  const Icon = (m.icon ? ICON_MAP[m.icon] : null) || CreditCard
                  const isPaying = payingMethod?.id === m.id
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => {
                          setPayingMethod(m)
                          initiateMutation.mutate({
                            method: m.type,
                            paymentMethodId: m.id,
                            requestId: selectedRequest,
                          })
                        }}
                        disabled={initiateMutation.isPending}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-lg"
                          style={{ backgroundColor: m.accentColor + '15', color: m.accentColor }}
                        >
                          {isPaying ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Icon className="h-5 w-5" />
                          )}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-900">
                            {m.label}
                          </p>
                          {m.description && (
                            <p className="text-xs text-slate-500">{m.description}</p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  data,
  onPayNow,
}: {
  data: PlatformFeeSummary
  onPayNow: () => void
}) {
  const isOverdue = data.isOverdue
  const isBlocked = data.isBlocked
  const hasOutstanding = data.outstanding > 0

  return (
    <Card className={isBlocked ? 'border-red-300 bg-red-50/30' : isOverdue ? 'border-amber-300 bg-amber-50/30' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Outstanding platform fees</span>
          {isBlocked && (
            <Badge className="bg-red-500 text-white">
              <Ban className="mr-1 h-3 w-3" /> QR Blocked
            </Badge>
          )}
          {isOverdue && !isBlocked && (
            <Badge className="bg-amber-500 text-white">
              <AlertTriangle className="mr-1 h-3 w-3" /> Overdue
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tracking-tight text-slate-900">
            {formatINR(data.outstanding)}
          </span>
          <span className="text-sm text-slate-500">
            · {data.pendingCount} {data.pendingCount === 1 ? 'fee' : 'fees'} pending
          </span>
        </div>

        {data.oldestPendingDate && (
          <p className="text-xs text-slate-500">
            <Clock3 className="mr-1 inline h-3 w-3" />
            Oldest pending fee: {formatRelative(data.oldestPendingDate)}
            {isOverdue && (
              <span className="ml-1 text-amber-700">
                · overdue by {Math.floor((Date.now() - new Date(data.oldestPendingDate).getTime()) / (24 * 60 * 60 * 1000))} days
              </span>
            )}
          </p>
        )}

        {isBlocked && data.restaurant.platformFeeBlockReason && (
          <div className="rounded-md bg-red-100 px-3 py-2 text-xs text-red-800">
            <Ban className="mr-1 inline h-3 w-3" />
            Your QR codes are blocked. Reason: {data.restaurant.platformFeeBlockReason}
          </div>
        )}

        {/* Lifetime stats */}
        <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
          <Stat label="Lifetime fees" value={formatINR(data.totals.lifetime)} />
          <Stat label="Collected" value={formatINR(data.totals.collected)} tone="green" />
          <Stat label="Pending" value={formatINR(data.totals.pending)} tone="amber" />
        </div>

        <Button
          onClick={onPayNow}
          disabled={!hasOutstanding}
          className="w-full"
          size="lg"
        >
          {hasOutstanding ? (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Pay {formatINR(data.outstanding)} now
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              All fees paid
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'green' | 'amber'
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          tone === 'green'
            ? 'text-sm font-bold text-emerald-700'
            : tone === 'amber'
              ? 'text-sm font-bold text-amber-700'
              : 'text-sm font-bold text-slate-900'
        }
      >
        {value}
      </p>
    </div>
  )
}

function MethodIcon({ type }: { type: string }) {
  const Icon = ICON_MAP[type] || CreditCard
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
      <Icon className="h-4 w-4" />
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PAID':
    case 'COLLECTED_DIRECT':
      return (
        <Badge className="bg-emerald-100 text-emerald-800">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Paid
        </Badge>
      )
    case 'PROCESSING':
      return (
        <Badge variant="outline">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Processing
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge variant="outline">
          <Clock3 className="mr-1 h-3 w-3" /> Pending
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge className="bg-red-100 text-red-800">
          <AlertTriangle className="mr-1 h-3 w-3" /> Failed
        </Badge>
      )
    case 'REFUNDED':
      return (
        <Badge className="bg-slate-100 text-slate-700">
          <ArrowRightCircle className="mr-1 h-3 w-3" /> Refunded
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
