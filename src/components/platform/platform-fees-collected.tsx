'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/restaurant/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import {
  Loader2,
  IndianRupee,
  Building2,
  TrendingUp,
  Calendar,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ChevronsDownUp,
  ChevronsUpDown,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ShieldAlert,
  Send,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatINR, formatRelative } from '@/lib/format'
import { useSocketEvent } from '@/hooks/use-socket'

const PIE_COLORS = ['#EA580C', '#16A34A', '#9333EA', '#0EA5E9', '#F59E0B']
const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
]
const GROUP_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const
const RECENT_GROUP_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const

type GroupBy = (typeof GROUP_OPTIONS)[number]['value']
type RecentGroupBy = (typeof RECENT_GROUP_OPTIONS)[number]['value']

interface TenantRow {
  restaurantId: string
  restaurantName: string
  slug: string
  plan: string
  feeCount: number
  collected: number
  pending: number
  refunded: number
  customerPaid: number
  restaurantPaid: number
}

interface TenantPeriodRow {
  restaurantId: string
  restaurantName: string
  slug: string
  plan: string
  period: string
  feeCount: number
  collected: number
  pending: number
  refunded: number
  customerPaid: number
  restaurantPaid: number
}

interface RecentFee {
  id: string
  feeType: string
  feeAmount: number
  baseAmount: number
  payer: string
  status: string
  collectedAt: string | null
  createdAt: string
  restaurant: { id: string; name: string; slug: string; plan: string }
  order: { id: string; orderNumber: string; grandTotal: number }
}

interface OverdueTenant {
  restaurantId: string
  restaurantName: string
  slug: string
  plan: string
  pendingAmount: number
  oldestPendingDate: string
  daysOverdue: number
  feeCount: number
}

interface TenantBlockedInfo {
  id: string
  platformFeeBlocked: boolean
}

interface FeesData {
  range: string
  from: string
  to: string
  groupBy: GroupBy
  totalCollected: number
  totalPending: number
  totalRefunded: number
  totalFees: number
  byTenant: TenantRow[]
  byTenantByPeriod: TenantPeriodRow[]
  byFeeType: Array<{ feeType: string; amount: number }>
  byPayer: Array<{ payer: string; amount: number }>
  recentFees: RecentFee[]
  overdueTenants?: OverdueTenant[]
}

type SortColumn =
  | 'feeCount'
  | 'collected'
  | 'pending'
  | 'refunded'
  | 'restaurantPaid'
  | 'customerPaid'
type SortDirection = 'asc' | 'desc'

/** Returns the period bucket key for a date based on the grouping mode. */
function getPeriodKey(date: Date, groupBy: GroupBy | RecentGroupBy): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (groupBy === 'day') return `${y}-${m}-${d}`
  if (groupBy === 'year') return `${y}`
  return `${y}-${m}` // month
}

/** Human-friendly label for a period bucket key. */
function formatPeriodLabel(period: string, groupBy: GroupBy | RecentGroupBy): string {
  if (groupBy === 'day') {
    const [y, m, d] = period.split('-')
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date)
  }
  if (groupBy === 'year') return period
  // month
  const [y, m] = period.split('-')
  const date = new Date(Number(y), Number(m) - 1, 1)
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

async function fetchFees(range: string, groupBy: GroupBy): Promise<FeesData> {
  const res = await fetch(`/api/platform/fees?range=${range}&groupBy=${groupBy}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('Failed to load fees')
  const json = await res.json()
  return json.data
}

async function fetchTenantsBlockedInfo(): Promise<TenantBlockedInfo[]> {
  const res = await fetch('/api/platform/restaurants?search=', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load tenants')
  const json = await res.json()
  return (json.data || []).map((t: any) => ({
    id: t.id,
    platformFeeBlocked: !!t.platformFeeBlocked,
  }))
}

export function PlatformFeesCollected() {
  const [range, setRange] = useState('30d')
  const [groupBy, setGroupBy] = useState<GroupBy>('month')
  const [recentGroupBy, setRecentGroupBy] = useState<RecentGroupBy>('none')

  // Expand/collapse state for by-tenant table
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'collected',
    direction: 'desc',
  })

  // Expand/collapse state for recent fees buckets
  const [expandedRecent, setExpandedRecent] = useState<Set<string>>(new Set())

  const qc = useQueryClient()
  const [blockTarget, setBlockTarget] = useState<OverdueTenant | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['platform-fees', range, groupBy],
    queryFn: () => fetchFees(range, groupBy),
    refetchInterval: 30_000,
  })

  // Look up the current platformFeeBlocked flag for each restaurant so we can
  // show a "Blocked" badge / "Unblock" button instead of "Block QR".
  const { data: tenantsBlockedInfo } = useQuery({
    queryKey: ['platform-tenants', 'blocked-status'],
    queryFn: fetchTenantsBlockedInfo,
    refetchInterval: 30_000,
  })

  const blockedMap = useMemo<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>()
    for (const t of tenantsBlockedInfo || []) {
      m.set(t.id, !!t.platformFeeBlocked)
    }
    return m
  }, [tenantsBlockedInfo])

  const blockMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/platform/restaurants/${id}/block-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: true, reason }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to block QR')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('QR blocked — customers can no longer scan codes at this restaurant')
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
      setBlockTarget(null)
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to block QR'),
  })

  const unblockMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/platform/restaurants/${id}/block-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: false }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to unblock QR')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('QR unblocked — customers can scan codes again')
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to unblock QR'),
  })

  // ----- Platform fee payment request mutation -----
  // Sends a "please pay ₹X by date Y" request to a tenant. Fires a
  // `platform:feeRequested` realtime event the tenant sees in their
  // Settings → Platform fees tab.
  const [requestTarget, setRequestTarget] = useState<TenantRow | null>(null)
  const [requestAmount, setRequestAmount] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [requestDueDate, setRequestDueDate] = useState('')

  const requestMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      amount,
      dueDate,
      note,
    }: {
      restaurantId: string
      amount: number
      dueDate?: string
      note?: string
    }) => {
      const res = await fetch('/api/platform/fees/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          amount,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          note: note || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to send payment request')
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      toast.success('Payment request sent', {
        description: `${formatINR(vars.amount)} requested from ${
          requestTarget?.restaurantName || 'tenant'
        }`,
      })
      setRequestTarget(null)
      setRequestAmount('')
      setRequestNote('')
      setRequestDueDate('')
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send request'),
  })

  // ----- Manual collect mutation -----
  // Super admin marks a tenant's pending fees as COLLECTED_DIRECT (for
  // offline cash / bank transfer settlements). Fires `platform:feePaid`
  // + `platform:feeCollected` realtime events.
  const [collectTarget, setCollectTarget] = useState<TenantRow | null>(null)

  const collectMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      amount,
      note,
    }: {
      restaurantId: string
      amount?: number
      note?: string
    }) => {
      const res = await fetch('/api/platform/fees/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          amount: amount || undefined,
          note: note || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to collect fees')
      }
      return res.json()
    },
    onSuccess: (json) => {
      const d = json.data
      toast.success('Fees collected', {
        description: `${formatINR(d.amount)} collected from ${collectTarget?.restaurantName || 'tenant'} · ${d.feesCovered} fees`,
      })
      setCollectTarget(null)
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to collect'),
  })

  // ----- Realtime subscriptions -----
  // When a tenant pays their platform fees, the `platform:feePaid` event
  // fires. We refetch the platform fees summary so the by-tenant table and
  // KPIs update live (no manual refresh).
  useSocketEvent<{ paymentId: string; amount: number; restaurantName: string }>(
    'platform:feePaid',
    (payload) => {
      toast.success('Platform fee payment received', {
        description: `${formatINR(payload.amount)} from ${payload.restaurantName}`,
      })
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
    },
  )

  // When a tenant initiates a payment (clicks "Pay now"), show a toast and
  // refetch so the super admin sees the in-progress payment.
  useSocketEvent<{ amount: number; restaurantName: string }>(
    'platform:feePaymentInit',
    (payload) => {
      toast.info('Tenant started a payment', {
        description: `${payload.restaurantName} initiated ${formatINR(payload.amount)}`,
      })
      qc.invalidateQueries({ queryKey: ['platform-fees'] })
    },
  )

  // ----- Sorting + totals for the by-tenant table -----
  const sortedTenants = useMemo<TenantRow[]>(() => {
    if (!data) return []
    const rows = [...data.byTenant]
    const dir = sort.direction === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = a[sort.column]
      const bv = b[sort.column]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return rows
  }, [data, sort])

  const totals = useMemo(() => {
    if (!data) {
      return { feeCount: 0, collected: 0, pending: 0, refunded: 0, restaurantPaid: 0, customerPaid: 0 }
    }
    return data.byTenant.reduce(
      (acc, t) => ({
        feeCount: acc.feeCount + t.feeCount,
        collected: acc.collected + t.collected,
        pending: acc.pending + t.pending,
        refunded: acc.refunded + t.refunded,
        restaurantPaid: acc.restaurantPaid + t.restaurantPaid,
        customerPaid: acc.customerPaid + t.customerPaid,
      }),
      { feeCount: 0, collected: 0, pending: 0, refunded: 0, restaurantPaid: 0, customerPaid: 0 },
    )
  }, [data])

  // ----- Period breakdowns indexed by restaurantId -----
  const periodsByTenant = useMemo<Record<string, TenantPeriodRow[]>>(() => {
    if (!data) return {}
    const out: Record<string, TenantPeriodRow[]> = {}
    for (const p of data.byTenantByPeriod) {
      ;(out[p.restaurantId] ||= []).push(p)
    }
    // Sort each tenant's periods ascending (oldest first)
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => a.period.localeCompare(b.period))
    }
    return out
  }, [data])

  // ----- Recent fees grouped by period -----
  const recentGroups = useMemo<Array<{ period: string; fees: RecentFee[]; totalAmount: number }>>(() => {
    if (!data || recentGroupBy === 'none') return []
    const map = new Map<string, RecentFee[]>()
    for (const f of data.recentFees) {
      const key = getPeriodKey(new Date(f.createdAt), recentGroupBy)
      const existing = map.get(key)
      if (existing) existing.push(f)
      else map.set(key, [f])
    }
    return Array.from(map.entries())
      .map(([period, fees]) => ({
        period,
        fees,
        totalAmount: fees.reduce((s, f) => s + f.feeAmount, 0),
      }))
      .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0)) // newest first
  }, [data, recentGroupBy])

  // ----- Expand / collapse handlers -----
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function expandAll() {
    if (!data) return
    setExpanded(new Set(data.byTenant.map((t) => t.restaurantId)))
  }
  function collapseAll() {
    setExpanded(new Set())
  }
  function toggleSort(column: SortColumn) {
    setSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: 'desc' }
    })
  }
  function toggleRecentExpand(key: string) {
    setExpandedRecent((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
      </div>
    )
  }
  if (!data) return null

  const statusColor: Record<string, string> = {
    COLLECTED: 'bg-emerald-50 text-emerald-700',
    PENDING: 'bg-amber-50 text-amber-700',
    REFUNDED: 'bg-purple-50 text-purple-700',
    WAIVED: 'bg-slate-100 text-slate-700',
  }
  const feeTypeLabel: Record<string, string> = {
    PERCENTAGE: '%',
    FIXED_PER_ORDER: 'Fixed',
    HYBRID: 'Hybrid',
    MONTHLY_SUBSCRIPTION: 'Monthly',
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Fees Collected</h1>
          <p className="text-sm text-muted-foreground">
            Track commission revenue across all tenants
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="mr-2 h-4 w-4" />
              <span className="text-xs text-muted-foreground">Group:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total collected" value={formatINR(data.totalCollected)} icon={<IndianRupee className="h-4 w-4" />} tone="green" />
        <KpiCard label="Pending" value={formatINR(data.totalPending)} icon={<IndianRupee className="h-4 w-4" />} tone="orange" />
        <KpiCard label="Refunded" value={formatINR(data.totalRefunded)} icon={<IndianRupee className="h-4 w-4" />} tone="purple" />
        <KpiCard label="Total fees" value={String(data.totalFees)} icon={<TrendingUp className="h-4 w-4" />} tone="blue" />
      </div>

      {/* Overdue tenants — pending fees older than 30 days */}
      <OverdueTenantsCard
        overdueTenants={data.overdueTenants || []}
        blockedMap={blockedMap}
        onBlock={setBlockTarget}
        onUnblock={(t) => unblockMutation.mutate(t.restaurantId)}
        blockPending={blockMutation.isPending}
        unblockPendingId={unblockMutation.isPending ? unblockMutation.variables ?? null : null}
      />

      {/* Confirmation dialog for blocking a tenant's QR */}
      <ConfirmDialog
        open={!!blockTarget}
        onOpenChange={(v) => !v && setBlockTarget(null)}
        title={blockTarget ? `Block QR for ${blockTarget.restaurantName}?` : ''}
        description={
          blockTarget ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <p>
                  This will <span className="font-semibold text-red-700">prevent customers</span> from
                  scanning QR codes or placing orders at{' '}
                  <strong>{blockTarget.restaurantName}</strong> ({blockTarget.slug}). The restaurant
                  will remain blocked until you manually unblock it.
                </p>
              </div>
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Pending amount: <span className="font-semibold">{formatINR(blockTarget.pendingAmount)}</span></span>
                  <span>Oldest fee: <span className="font-semibold">{formatRelative(blockTarget.oldestPendingDate)}</span></span>
                  <span>Days overdue: <span className="font-semibold text-red-700">{blockTarget.daysOverdue}</span></span>
                  <span>Fee count: <span className="font-semibold">{blockTarget.feeCount}</span></span>
                </div>
              </div>
            </div>
          ) : undefined
        }
        confirmLabel="Block QR"
        variant="destructive"
        onConfirm={() => {
          if (!blockTarget) return
          blockMutation.mutate({
            id: blockTarget.restaurantId,
            reason: 'Overdue platform fees',
          })
        }}
      />

      {/* Request payment dialog (super admin → tenant) */}
      <Dialog open={!!requestTarget} onOpenChange={(o) => !o && setRequestTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-orange-600" />
              Request platform fee payment
            </DialogTitle>
            <DialogDescription>
              Send a payment request to{' '}
              <strong>{requestTarget?.restaurantName}</strong>. They will see it in
              their Settings → Platform fees tab with a "Pay now" action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amount (₹)
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={requestAmount}
                onChange={(e) => setRequestAmount(e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="0.00"
              />
              {requestTarget && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Current pending: {formatINR(requestTarget.pending)}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Due date (optional)
              </label>
              <input
                type="date"
                value={requestDueDate}
                onChange={(e) => setRequestDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Note (optional)
              </label>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Please settle your outstanding platform fees"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!requestTarget) return
                const amt = parseFloat(requestAmount)
                if (!amt || amt <= 0) {
                  toast.error('Enter a valid amount')
                  return
                }
                requestMutation.mutate({
                  restaurantId: requestTarget.restaurantId,
                  amount: amt,
                  dueDate: requestDueDate || undefined,
                  note: requestNote || undefined,
                })
              }}
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual collect confirmation dialog (offline settlements) */}
      <ConfirmDialog
        open={!!collectTarget}
        onOpenChange={(v) => !v && setCollectTarget(null)}
        title={collectTarget ? `Collect fees from ${collectTarget.restaurantName}?` : ''}
        description={
          collectTarget ? (
            <div className="space-y-2 text-sm">
              <p>
                This will mark <strong>{formatINR(collectTarget.pending)}</strong> of
                pending fees as <span className="font-semibold text-emerald-700">COLLECTED</span>.
                The tenant's outstanding balance will drop to zero.
              </p>
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="mr-1 inline h-3 w-3" />
                Use this for offline settlements (cash, bank transfer, etc.) where
                there's no in-app payment to verify. A PlatformFeePayment row with
                status <code className="font-mono">COLLECTED_DIRECT</code> will be
                created for audit.
              </div>
            </div>
          ) : undefined
        }
        confirmLabel="Mark collected"
        variant="default"
        onConfirm={() => {
          if (!collectTarget) return
          collectMutation.mutate({
            restaurantId: collectTarget.restaurantId,
            amount: collectTarget.pending || undefined,
            note: 'Manual collection by super admin',
          })
        }}
      />

      {/* Charts */}
      <div className="grid gap-4 grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By payer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.byPayer}
                    dataKey="amount"
                    nameKey="payer"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e: any) => `${e.payer}`}
                  >
                    {data.byPayer.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                    formatter={(v: number) => formatINR(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* By Tenant table (collapsible per restaurant, sortable, with total row) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Fees by tenant</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {expanded.size} / {data.byTenant.length} expanded
            </span>
            <Button size="sm" variant="outline" onClick={expandAll} disabled={data.byTenant.length === 0}>
              <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />
              Expand all
            </Button>
            <Button size="sm" variant="outline" onClick={collapseAll} disabled={expanded.size === 0}>
              <ChevronsDownUp className="mr-1 h-3.5 w-3.5" />
              Collapse all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Restaurant</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Plan</th>
                  <SortableTh column="feeCount" sort={sort} onSort={toggleSort} label="Fees" align="right" />
                  <SortableTh column="collected" sort={sort} onSort={toggleSort} label="Collected" align="right" />
                  <SortableTh column="pending" sort={sort} onSort={toggleSort} label="Pending" align="right" />
                  <SortableTh column="refunded" sort={sort} onSort={toggleSort} label="Refunded" align="right" />
                  <SortableTh column="restaurantPaid" sort={sort} onSort={toggleSort} label="Restaurant paid" align="right" />
                  <SortableTh column="customerPaid" sort={sort} onSort={toggleSort} label="Customer paid" align="right" />
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>

              {sortedTenants.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      No fees collected in this range
                    </td>
                  </tr>
                </tbody>
              ) : (
                sortedTenants.map((t) => {
                  const periods = periodsByTenant[t.restaurantId] || []
                  const isOpen = expanded.has(t.restaurantId)
                  return (
                    <Collapsible key={t.restaurantId} asChild open={isOpen} onOpenChange={(o) => o ? toggleExpand(t.restaurantId) : toggleExpand(t.restaurantId)}>
                      <tbody className="group">
                        <CollapsibleTrigger asChild>
                          <tr className="cursor-pointer border-b last:border-0 hover:bg-slate-50">
                            <td className="px-2 py-2 text-center">
                              {periods.length > 0 ? (
                                isOpen ? (
                                  <ChevronDown className="mx-auto h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="mx-auto h-4 w-4 text-muted-foreground" />
                                )
                              ) : null}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <p className="font-medium">{t.restaurantName}</p>
                                  <p className="text-[10px] text-muted-foreground">/{t.slug}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2"><Badge variant="outline">{t.plan}</Badge></td>
                            <td className="px-4 py-2 text-right">{t.feeCount}</td>
                            <td className="px-4 py-2 text-right font-bold text-emerald-700">{formatINR(t.collected)}</td>
                            <td className="px-4 py-2 text-right text-amber-600">{t.pending > 0 ? formatINR(t.pending) : '—'}</td>
                            <td className="px-4 py-2 text-right text-purple-700">{t.refunded > 0 ? formatINR(t.refunded) : '—'}</td>
                            <td className="px-4 py-2 text-right">{formatINR(t.restaurantPaid)}</td>
                            <td className="px-4 py-2 text-right">{formatINR(t.customerPaid)}</td>
                            <td className="px-4 py-2">
                              {t.pending > 0 ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setRequestTarget(t)
                                      setRequestAmount(String(t.pending.toFixed(2)))
                                    }}
                                  >
                                    <Send className="mr-1 h-3 w-3" />
                                    Request
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setCollectTarget(t)
                                    }}
                                  >
                                    <Wallet className="mr-1 h-3 w-3" />
                                    Collect
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        </CollapsibleTrigger>

                        {periods.length > 0 && periods.map((p) => (
                          <CollapsibleContent asChild key={`${t.restaurantId}-${p.period}`}>
                            <tr className="border-b bg-slate-50/60 last:border-0">
                              <td className="px-2 py-2" />
                              <td className="px-4 py-2" colSpan={2}>
                                <span className="ml-6 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                  <Calendar className="h-3 w-3" />
                                  {formatPeriodLabel(p.period, groupBy)}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right text-xs">{p.feeCount}</td>
                              <td className="px-4 py-2 text-right text-xs font-semibold text-emerald-700">{formatINR(p.collected)}</td>
                              <td className="px-4 py-2 text-right text-xs text-amber-600">{p.pending > 0 ? formatINR(p.pending) : '—'}</td>
                              <td className="px-4 py-2 text-right text-xs text-purple-700">{p.refunded > 0 ? formatINR(p.refunded) : '—'}</td>
                              <td className="px-4 py-2 text-right text-xs">{formatINR(p.restaurantPaid)}</td>
                              <td className="px-4 py-2 text-right text-xs">{formatINR(p.customerPaid)}</td>
                              <td className="px-4 py-2" />
                            </tr>
                          </CollapsibleContent>
                        ))}
                      </tbody>
                    </Collapsible>
                  )
                })
              )}

              {/* Total row */}
              {data.byTenant.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                    <td className="px-2 py-2" />
                    <td className="px-4 py-2" colSpan={2}>
                      <span className="text-sm uppercase tracking-wide text-slate-700">Total ({data.byTenant.length} restaurants)</span>
                    </td>
                    <td className="px-4 py-2 text-right">{totals.feeCount}</td>
                    <td className="px-4 py-2 text-right text-emerald-700">{formatINR(totals.collected)}</td>
                    <td className="px-4 py-2 text-right text-amber-600">{totals.pending > 0 ? formatINR(totals.pending) : '—'}</td>
                    <td className="px-4 py-2 text-right text-purple-700">{totals.refunded > 0 ? formatINR(totals.refunded) : '—'}</td>
                    <td className="px-4 py-2 text-right">{formatINR(totals.restaurantPaid)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(totals.customerPaid)}</td>
                    <td className="px-4 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent fees */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent fee transactions</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Group by:</span>
            <div className="flex rounded-md border bg-slate-50 p-0.5">
              {RECENT_GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRecentGroupBy(opt.value)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    recentGroupBy === opt.value
                      ? 'bg-orange-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Order</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Restaurant</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Type</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Base</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Fee</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Payer</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">When</th>
                </tr>
              </thead>

              {data.recentFees.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No recent fees
                    </td>
                  </tr>
                </tbody>
              ) : recentGroupBy === 'none' ? (
                <tbody>
                  {data.recentFees.map((f) => (
                    <RecentFeeRow key={f.id} f={f} statusColor={statusColor} feeTypeLabel={feeTypeLabel} />
                  ))}
                </tbody>
              ) : (
                recentGroups.map((g) => {
                  const bucketKey = `${recentGroupBy}:${g.period}`
                  const isOpen = expandedRecent.has(bucketKey)
                  return (
                    <Collapsible
                      key={bucketKey}
                      asChild
                      open={isOpen}
                      onOpenChange={(o) => o ? toggleRecentExpand(bucketKey) : toggleRecentExpand(bucketKey)}
                    >
                      <tbody className="group">
                        <CollapsibleTrigger asChild>
                          <tr className="cursor-pointer border-b bg-slate-50/80 hover:bg-slate-100">
                            <td className="px-2 py-2 text-center">
                              {isOpen ? (
                                <ChevronDown className="mx-auto h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="mx-auto h-4 w-4 text-muted-foreground" />
                              )}
                            </td>
                            <td className="px-4 py-2" colSpan={4}>
                              <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                                <Calendar className="h-3.5 w-3.5 text-orange-600" />
                                {formatPeriodLabel(g.period, recentGroupBy)}
                                <Badge variant="outline" className="ml-1 text-[10px]">{g.fees.length} fees</Badge>
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right font-bold text-emerald-700">{formatINR(g.totalAmount)}</td>
                            <td className="px-4 py-2" colSpan={3} />
                          </tr>
                        </CollapsibleTrigger>

                        {g.fees.map((f) => (
                          <CollapsibleContent asChild key={f.id}>
                            <RecentFeeRowBody f={f} statusColor={statusColor} feeTypeLabel={feeTypeLabel} />
                          </CollapsibleContent>
                        ))}
                      </tbody>
                    </Collapsible>
                  )
                })
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Sortable column header — shows ▲/▼ on the active sort column. */
function SortableTh({
  column,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  column: SortColumn
  label: string
  sort: { column: SortColumn; direction: SortDirection }
  onSort: (c: SortColumn) => void
  align?: 'left' | 'right'
}) {
  const isActive = sort.column === column
  return (
    <th
      className={`px-4 py-2 text-xs font-semibold uppercase text-muted-foreground ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          isActive ? 'text-orange-700' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {isActive ? (
          sort.direction === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowDown className="h-3 w-3 opacity-0 group-hover:opacity-30" />
        )}
      </button>
    </th>
  )
}

function RecentFeeRow({
  f,
  statusColor,
  feeTypeLabel,
}: {
  f: RecentFee
  statusColor: Record<string, string>
  feeTypeLabel: Record<string, string>
}) {
  return (
    <RecentFeeRowBody f={f} statusColor={statusColor} feeTypeLabel={feeTypeLabel} />
  )
}

function RecentFeeRowBody({
  f,
  statusColor,
  feeTypeLabel,
}: {
  f: RecentFee
  statusColor: Record<string, string>
  feeTypeLabel: Record<string, string>
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-slate-50">
      <td className="px-2 py-2" />
      <td className="px-4 py-2 font-mono text-xs">{f.order.orderNumber}</td>
      <td className="px-4 py-2">{f.restaurant.name}</td>
      <td className="px-4 py-2"><Badge variant="outline">{feeTypeLabel[f.feeType] || f.feeType}</Badge></td>
      <td className="px-4 py-2 text-right">{formatINR(f.baseAmount)}</td>
      <td className="px-4 py-2 text-right font-bold text-emerald-700">{formatINR(f.feeAmount)}</td>
      <td className="px-4 py-2 text-xs">{f.payer}</td>
      <td className="px-4 py-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[f.status] || 'bg-slate-100'}`}>
          {f.status}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground">{formatRelative(f.collectedAt || f.createdAt)}</td>
    </tr>
  )
}

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: 'orange' | 'green' | 'blue' | 'purple'
}) {
  const toneClass = {
    orange: 'bg-orange-50 text-orange-700',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    purple: 'bg-violet-50 text-violet-700',
  }[tone]
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      </CardContent>
    </Card>
  )
}

/**
 * Overdue Tenants card — shows restaurants whose pending platform fees are
 * older than 30 days. Each row has a "Block QR" action that prevents
 * customers from scanning that restaurant's QR codes (or a "Blocked" badge
 * + "Unblock" button if already blocked).
 */
function OverdueTenantsCard({
  overdueTenants,
  blockedMap,
  onBlock,
  onUnblock,
  blockPending,
  unblockPendingId,
}: {
  overdueTenants: OverdueTenant[]
  blockedMap: Map<string, boolean>
  onBlock: (t: OverdueTenant) => void
  onUnblock: (t: OverdueTenant) => void
  blockPending: boolean
  unblockPendingId: string | null
}) {
  // Empty state — all tenants are up to date
  if (overdueTenants.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              No overdue platform fees — all tenants are up to date.
            </p>
            <p className="text-xs text-emerald-700/80">
              Restaurants with pending fees older than 30 days will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-red-200">
      <CardHeader className="border-b border-red-100 bg-red-50/60 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base text-red-800">
              Overdue Platform Fees — {overdueTenants.length} {overdueTenants.length === 1 ? 'tenant' : 'tenants'}
            </CardTitle>
            <p className="text-xs text-red-700/80">
              Pending fees older than 30 days. Block QR to prevent customers from ordering until fees are settled.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Restaurant</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Plan</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Pending Amount</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Oldest Pending Fee</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Days Overdue</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Fee Count</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {overdueTenants.map((t) => {
                const isBlocked = blockedMap.get(t.restaurantId) === true
                const isUnblocking = unblockPendingId === t.restaurantId
                return (
                  <tr key={t.restaurantId} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.restaurantName}</p>
                          <p className="text-[10px] text-muted-foreground">/{t.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2"><Badge variant="outline">{t.plan}</Badge></td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">
                      {formatINR(t.pendingAmount)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatRelative(t.oldestPendingDate)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          t.daysOverdue > 60
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {t.daysOverdue}d
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{t.feeCount}</td>
                    <td className="px-4 py-2 text-right">
                      {isBlocked ? (
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[10px] font-bold uppercase text-white"
                            title="Customers cannot scan QR codes at this restaurant"
                          >
                            <ShieldAlert className="h-3 w-3" />
                            Blocked
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            disabled={isUnblocking}
                            onClick={() => onUnblock(t)}
                          >
                            {isUnblocking ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Unblock
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={blockPending}
                          onClick={() => onBlock(t)}
                        >
                          <Ban className="mr-1 h-3.5 w-3.5" />
                          Block QR
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
