'use client'

import { useMemo, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { PaymentStatusBadge } from '@/components/restaurant/payment-status-badge'
import { Price, formatINR } from '@/components/restaurant/price'
import { VegBadge } from '@/components/restaurant/veg-badge'
import { EmptyState, LoadingSpinner } from '@/components/restaurant/loading-states'
import { useAdminOrders, useAdminOrder, useUpdateOrderStatus, useRequestPayment, useMarkCashPaid, useAdminBranches, api } from '@/hooks/api'
import { Search, Filter, X, Clock, ChefHat, CheckCircle2, BellRing, Utensils, XCircle, Phone, User, CreditCard, Banknote, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import type { OrderStatus } from '@/lib/types'

const STATUSES: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED']

// ---------------------------------------------------------------------------
// Date grouping for the collapsible orders list
// ---------------------------------------------------------------------------

interface DateGroup {
  /** Stable per-day key (local calendar day) used for collapse state. */
  key: string
  /** Human label: "Today", "Yesterday", or "Mon, 8 Sep 2026". */
  label: string
  orders: any[]
  /** Sum of grandTotal excluding CANCELLED orders (shown in the header). */
  netTotal: number
}

function groupOrdersByDate(orders: any[]): DateGroup[] {
  const groups: DateGroup[] = []
  const byKey = new Map<string, DateGroup>()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000

  for (const o of orders) {
    const d = new Date(o.placedAt)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let g = byKey.get(key)
    if (!g) {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const label =
        dayStart === startOfToday
          ? `Today · ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : dayStart === startOfYesterday
            ? `Yesterday · ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : d.toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
      g = { key, label, orders: [], netTotal: 0 }
      byKey.set(key, g)
      groups.push(g)
    }
    g.orders.push(o)
    if (o.status !== 'CANCELLED') g.netTotal += Number(o.grandTotal) || 0
  }
  return groups
}

/** One row in a day's orders table (shared by every date group). */
function OrderRow({ order: o, onOpen }: { order: any; onOpen: () => void }) {
  return (
    <tr className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={onOpen}>
      <td className="p-3 font-medium">{o.orderNumber}</td>
      <td className="p-3">
        {o.table?.number}
        {o.branch?.name && (
          <span className="ml-1.5 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
            {o.branch.name}
          </span>
        )}
      </td>
      <td className="p-3 text-muted-foreground">
        {new Date(o.placedAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className="p-3">{o._count?.items || o.items?.length || 0}</td>
      <td className="p-3 font-semibold">{formatINR(o.grandTotal)}</td>
      <td className="p-3"><OrderStatusBadge status={o.status} /></td>
      <td className="p-3"><PaymentStatusBadge status={o.paymentStatus} /></td>
      <td className="p-3 text-right">
        <Button size="sm" variant="ghost">
          View →
        </Button>
      </td>
    </tr>
  )
}

export function OrdersManager() {
  const { data: session } = useSession()
  // Branch-wise filtering is an owner / super-admin capability — branch-scoped
  // roles (manager, waiter, kitchen, cashier) are forced to their own branch
  // server-side, so the selector is meaningless (and hidden) for them.
  const canFilterBranch =
    session?.user?.role === 'RESTAURANT_OWNER' || session?.user?.role === 'SUPER_ADMIN'
  const [filters, setFilters] = useState<{
    status?: string
    paymentStatus?: string
    search?: string
  }>({})
  // 'all' (default, unchanged behavior) | '<branchId>' | 'none' (branchless)
  const [branchView, setBranchView] = useState<string>('all')
  const { data: branchData } = useAdminBranches(canFilterBranch)
  const branches = branchData?.branches || []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const { data, isLoading } = useAdminOrders({
    ...filters,
    ...(canFilterBranch && branchView !== 'all' ? { branchId: branchView } : {}),
  })
  const updateStatus = useUpdateOrderStatus()
  const branchLabel =
    branchView === 'none'
      ? 'branchless orders'
      : branches.find((b: any) => b.id === branchView)?.name

  // ---- Date grouping (collapsible by day) ----
  // Orders arrive sorted by placedAt desc, so groups are newest-first and the
  // first group is the most recent day (usually today) — the one expanded by
  // default. Toggling is tracked per day-key; days the user hasn't touched
  // fall back to "recent expanded / older collapsed" automatically, so a new
  // day rolling over never needs state migration.
  const [manualExpanded, setManualExpanded] = useState<Map<string, boolean>>(new Map())
  const dateGroups = useMemo(() => groupOrdersByDate(data?.orders || []), [data?.orders])
  const isGroupExpanded = (key: string, isMostRecent: boolean) =>
    manualExpanded.get(key) ?? isMostRecent
  const toggleGroup = (key: string) =>
    setManualExpanded((m) => {
      const next = new Map(m)
      const gi = dateGroups.findIndex((g) => g.key === key)
      const current = isGroupExpanded(key, gi === 0)
      next.set(key, !current)
      return next
    })

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {canFilterBranch && branchView !== 'all'
              ? `Showing ${branchLabel || 'selected branch'} · live`
              : 'All orders, live.'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order #"
              className="pl-8"
              value={filters.search || ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
            />
          </div>
          {canFilterBranch && (
            <Select value={branchView} onValueChange={setBranchView}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">No branch (branchless tables)</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select
            value={filters.status || 'ALL'}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, status: v === 'ALL' ? undefined : v }))
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.paymentStatus || 'ALL'}
            onValueChange={(v) =>
              setFilters((f) => ({
                ...f,
                paymentStatus: v === 'ALL' ? undefined : v,
              }))
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All payments</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="REFUNDED">Refunded</SelectItem>
            </SelectContent>
          </Select>
          {(filters.status || filters.paymentStatus || filters.search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({})}
            >
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Orders grouped by date — the most recent day (usually today) is
          expanded by default, older days start collapsed. */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.orders?.length ? (
        <EmptyState
          icon={<Filter className="h-6 w-6" />}
          title="No orders found"
          description="Try adjusting your filters, or wait for new orders to arrive."
        />
      ) : (
        <Card>
          {dateGroups.map((g, gi) => {
            const expanded = isGroupExpanded(g.key, gi === 0)
            return (
              <div key={g.key} className="border-b last:border-0">
                {/* Day header — click to collapse/expand */}
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
                >
                  <span className="flex items-center gap-2">
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        !expanded && '-rotate-90',
                      )}
                    />
                    <span className="text-sm font-semibold">{g.label}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-slate-200">
                      {g.orders.length} {g.orders.length === 1 ? 'order' : 'orders'}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.netTotal > 0 ? `${formatINR(g.netTotal)} (excl. cancelled)` : ''}
                  </span>
                </button>
                {expanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-white text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3">Order #</th>
                          <th className="p-3">Table</th>
                          <th className="p-3">Placed</th>
                          <th className="p-3">Items</th>
                          <th className="p-3">Total</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Payment</th>
                          <th className="p-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.orders.map((o: any) => (
                          <OrderRow key={o.id} order={o} onOpen={() => setSelectedId(o.id)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {/* Order detail sheet */}
      <OrderDetailSheet
        orderId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </div>
  )
}

function OrderDetailSheet({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: order, isLoading } = useAdminOrder(orderId)
  const updateStatus = useUpdateOrderStatus()
  const requestPayment = useRequestPayment()
  const markCashPaid = useMarkCashPaid()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const canTransitionTo = (current: string): Array<{ status: string; label: string; variant?: any }> => {
    const map: Record<string, Array<{ status: string; label: string; variant?: any }>> = {
      NEW: [{ status: 'ACCEPTED', label: 'Accept order' }],
      ACCEPTED: [{ status: 'PREPARING', label: 'Start preparing' }],
      PREPARING: [{ status: 'READY', label: 'Mark ready' }],
      READY: [{ status: 'SERVED', label: 'Mark served' }],
      SERVED: [{ status: 'COMPLETED', label: 'Complete order' }],
      COMPLETED: [],
      CANCELLED: [],
    }
    return map[current] || []
  }

  const canCancel = order && ['NEW', 'ACCEPTED'].includes(order.status)
  // Pre-payment: only available when the order is NEW (not yet accepted) and
  // the customer hasn't paid yet. The restaurant owner is asking the customer
  // to settle the bill BEFORE the kitchen accepts the order.
  const canRequestPrePayment =
    order &&
    order.status === 'NEW' &&
    order.paymentStatus !== 'PAID' &&
    !order.prePaymentRequested
  // Post-payment: available when the order has been SERVED (received by the
  // customer) and not yet paid. The restaurant owner is asking the customer
  // to settle the bill before leaving the table.
  const canRequestPostPayment =
    order &&
    ['SERVED', 'READY'].includes(order.status) &&
    order.paymentStatus !== 'PAID' &&
    !order.postPaymentRequested

  const handleRequestPayment = async (when: 'PRE' | 'POST') => {
    if (!order) return
    try {
      await requestPayment.mutateAsync({ id: order.id, when })
      toast.success(
        when === 'PRE'
          ? 'Asked customer to pay before we accept the order'
          : 'Asked customer to pay now that the order is received',
      )
    } catch (err: any) {
      toast.error(err.message || 'Failed to request payment')
    }
  }

  const handleMarkCashPaid = async (method: 'CASH' | 'COUNTER' = 'CASH') => {
    if (!order) return
    try {
      const res = await markCashPaid.mutateAsync({ id: order.id, method })
      toast.success(
        `Marked as paid in ${method === 'COUNTER' ? 'counter' : 'cash'} by ${res.receivedBy}`,
      )
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark as paid')
    }
  }

  // Mark-as-cash is available whenever the order is unpaid AND the user is
  // waiter/owner/manager/cashier (the API enforces PAYMENT.VERIFY permission).
  // It covers both pre-payment (PENDING_PAYMENT) and post-payment (SERVED).
  const canMarkCashPaid =
    order &&
    order.paymentStatus !== 'PAID' &&
    ['PENDING_PAYMENT', 'NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {order?.orderNumber}
              {order && <OrderStatusBadge status={order.status} />}
            </SheetTitle>
            <SheetDescription>
              {order
                ? `Table ${order.table?.number}${order.branch?.name ? ` · ${order.branch.name}` : ''} · placed ${new Date(order.placedAt).toLocaleString('en-IN')}`
                : 'Loading…'}
            </SheetDescription>
          </SheetHeader>

          {isLoading || !order ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="space-y-4 px-4 pb-10">
              {/* Customer snapshot (name + phone collected at order placement) */}
              {(order.customerName || order.customerPhone) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Customer
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {order.customerName && (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <User className="h-3.5 w-3.5 text-slate-500" />
                        {order.customerName}
                      </span>
                    )}
                    {order.customerPhone && (
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="inline-flex items-center gap-1.5 text-orange-700 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {order.customerPhone}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Pre / post payment request banners */}
              {order.prePaymentRequested && order.paymentStatus !== 'PAID' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <CreditCard className="mr-1.5 inline h-4 w-4" />
                  Pre-payment requested — waiting for the customer to pay
                  ₹{order.grandTotal.toFixed(0)} before the order is accepted.
                </div>
              )}
              {order.postPaymentRequested && order.paymentStatus !== 'PAID' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <CreditCard className="mr-1.5 inline h-4 w-4" />
                  Post-payment requested — waiting for the customer to pay
                  ₹{order.grandTotal.toFixed(0)} after receiving the order.
                </div>
              )}

              {/* Cash-received-by info — shown when the order was paid in cash */}
              {order.paymentStatus === 'PAID' && order.cashReceivedByName && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <Banknote className="mr-1.5 inline h-4 w-4" />
                  Paid in {order.paymentMethod === 'COUNTER' ? 'counter' : 'cash'} by{' '}
                  <strong>{order.cashReceivedByName}</strong>
                  {order.cashReceivedAt && (
                    <span className="text-emerald-700">
                      {' '}on {new Date(order.cashReceivedAt).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              )}

              {/* PENDING_PAYMENT banner — order is hidden from the kitchen until paid */}
              {order.status === 'PENDING_PAYMENT' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <Clock className="mr-1.5 inline h-4 w-4" />
                  Awaiting customer payment — this order is hidden from the
                  kitchen until the customer pays. Once paid, it will
                  automatically move to <strong>NEW</strong> status.
                </div>
              )}

              {/* Items */}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Items</h3>
                <div className="space-y-2">
                  {order.items?.map((it: any) => (
                    <div key={it.id} className="rounded-lg border p-2.5">
                      <div className="flex items-start gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                          {it.quantity}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <VegBadge isVeg={it.isVeg} />
                            <p className="text-sm font-semibold">{it.menuItemName}</p>
                          </div>
                          {it.variantName && (
                            <p className="text-xs text-muted-foreground">
                              Size: {it.variantName}
                            </p>
                          )}
                          {it.modifiers?.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              + {it.modifiers.map((m: any) => m.modifierName).join(', ')}
                            </p>
                          )}
                          {it.notes && (
                            <p className="text-xs italic text-muted-foreground">“{it.notes}”</p>
                          )}
                        </div>
                        <Price amount={it.totalPrice} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <Row label="Subtotal" value={order.subtotal} />
                {order.taxAmount > 0 && <Row label="Tax" value={order.taxAmount} />}
                {order.serviceCharge > 0 && <Row label="Service" value={order.serviceCharge} />}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>Total</span>
                  <Price amount={order.grandTotal} size="lg" />
                </div>
              </div>

              {/* Timeline */}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
                <Timeline order={order} />
              </div>

              {/* Payment request buttons — restaurant owner can collect money
                  before accepting the order (PRE) or after it's received (POST) */}
              {(canRequestPrePayment || canRequestPostPayment) && (
                <div className="space-y-2">
                  {canRequestPrePayment && (
                    <Button
                      variant="outline"
                      className="w-full border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                      disabled={requestPayment.isPending}
                      onClick={() => handleRequestPayment('PRE')}
                    >
                      <CreditCard className="mr-2 h-4 w-4" />
                      Collect payment before accepting
                    </Button>
                  )}
                  {canRequestPostPayment && (
                    <Button
                      variant="outline"
                      className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={requestPayment.isPending}
                      onClick={() => handleRequestPayment('POST')}
                    >
                      <CreditCard className="mr-2 h-4 w-4" />
                      Collect payment after order received
                    </Button>
                  )}
                </div>
              )}

              {/* Mark-as-cash buttons — waiter / owner / manager / cashier can
                  mark the order as paid in cash (or at counter). The acting
                  user's name is recorded for the payments report. */}
              {canMarkCashPaid && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Mark as paid (recorded with your name)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={markCashPaid.isPending}
                      onClick={() => handleMarkCashPaid('CASH')}
                    >
                      <Banknote className="mr-2 h-4 w-4" />
                      Paid in cash
                    </Button>
                    <Button
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={markCashPaid.isPending}
                      onClick={() => handleMarkCashPaid('COUNTER')}
                    >
                      <Banknote className="mr-2 h-4 w-4" />
                      Paid at counter
                    </Button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {canTransitionTo(order.status).length > 0 && (
                <div className="space-y-2">
                  {canTransitionTo(order.status).map((t) => (
                    <Button
                      key={t.status}
                      className="w-full bg-orange-600 text-white hover:bg-orange-700"
                      disabled={updateStatus.isPending}
                      onClick={async () => {
                        try {
                          await updateStatus.mutateAsync({ id: order.id, status: t.status })
                          toast.success(`Order marked as ${t.status}`)
                        } catch (err: any) {
                          toast.error(err.message || 'Failed')
                        }
                      }}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              )}

              {canCancel && (
                <Button
                  variant="outline"
                  className="w-full border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => setCancelOpen(true)}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancel order
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order {order?.orderNumber}?</DialogTitle>
            <DialogDescription>
              This will inform the kitchen to halt preparation. The customer will
              be notified immediately.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={updateStatus.isPending}
              onClick={async () => {
                try {
                  await updateStatus.mutateAsync({
                    id: order!.id,
                    status: 'CANCELLED',
                    cancelReason,
                  })
                  toast.success('Order cancelled')
                  setCancelOpen(false)
                } catch (err: any) {
                  toast.error(err.message || 'Failed')
                }
              }}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

function Timeline({ order }: { order: any }) {
  const events = [
    { label: 'Placed', at: order.placedAt, icon: BellRing },
    { label: 'Accepted', at: order.acceptedAt, icon: CheckCircle2 },
    { label: 'Preparing', at: order.preparingAt, icon: ChefHat },
    { label: 'Ready', at: order.readyAt, icon: CheckCircle2 },
    { label: 'Served', at: order.servedAt, icon: Utensils },
    { label: 'Completed', at: order.completedAt, icon: CheckCircle2 },
  ].filter((e) => e.at)
  return (
    <div className="space-y-1.5">
      {events.map((e) => {
        const Icon = e.icon
        return (
          <div key={e.label} className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4 text-orange-600" />
            <span className="font-medium">{e.label}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(e.at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )
      })}
      {order.cancelledAt && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <XCircle className="h-4 w-4" />
          <span className="font-medium">Cancelled</span>
          <span className="text-xs">
            {new Date(order.cancelledAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  )
}
