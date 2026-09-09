'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowUpDown,
  Building2,
  IndianRupee,
  ShoppingBag,
  Percent,
  TrendingUp,
  Package,
  UtensilsCrossed,
} from 'lucide-react'
import { useNetworkReports, useAdminBranches } from '@/hooks/api'
import { LoadingSpinner, EmptyState } from '@/components/restaurant/loading-states'
import { cn } from '@/lib/utils'

const inr = (n: number | null | undefined) =>
  n === null || n === undefined || isNaN(n)
    ? '₹0'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(n)

type SortDir = 'asc' | 'desc'
interface SortState {
  key: string
  dir: SortDir
}

/** Generic client-side sorter for report rows. */
function useSortable<T extends Record<string, any>>(rows: T[]) {
  const [sort, setSort] = useState<SortState | null>(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sort])

  const toggle = (key: string) =>
    setSort((s) =>
      s?.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    )

  const icon = (key: string) => {
    if (sort?.key !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-slate-300" />
    return sort.dir === 'asc' ? (
      <ChevronUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-1 inline h-3 w-3" />
    )
  }

  return { sorted, toggle, icon }
}

function isoDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c.toISOString().slice(0, 10)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDay(d)
}

export function NetworkReports() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(isoDay(new Date()))
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day')
  const [branchId, setBranchId] = useState('all')

  const { data: branchData } = useAdminBranches()
  const branches = branchData?.branches || []

  const { data, isLoading } = useNetworkReports({ from, to, groupBy, branchId })
  const summary = data?.summary
  const periodRows = data?.periods || []
  const branchRows = data?.branches || []
  const productRows = data?.products || []

  // Sorters for the three tables
  const periodSort = useSortable(periodRows)
  const branchSort = useSortable(branchRows)
  const productSort = useSortable(productRows)

  const [openPeriods, setOpenPeriods] = useState<Set<string>>(new Set())
  const togglePeriod = (key: string) =>
    setOpenPeriods((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const setPreset = (days: number | 'month' | 'lastMonth') => {
    if (days === 'month') {
      const now = new Date()
      setFrom(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
      setTo(isoDay(new Date()))
    } else if (days === 'lastMonth') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      setFrom(isoDay(start))
      setTo(isoDay(end))
    } else {
      setFrom(daysAgo(days - 1))
      setTo(isoDay(new Date()))
    }
  }

  const allOpen = openPeriods.size > 0

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header + filters */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Network Reports</h1>
        <p className="text-sm text-slate-500">
          Sales, revenue, products and platform fee across all your branches — day-wise,
          month-wise, branch-wise.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Group by</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as 'day' | 'month')}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day-wise</SelectItem>
                <SelectItem value="month">Month-wise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setPreset(1)}>Today</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(7)}>7d</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(30)}>30d</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset('month')}>This month</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset('lastMonth')}>Last month</Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <IndianRupee className="h-3.5 w-3.5" /> Gross revenue
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">{inr(summary?.revenue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <ShoppingBag className="h-3.5 w-3.5" /> Orders
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">{summary?.orders ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <Percent className="h-3.5 w-3.5" /> Platform fee
                </p>
                <p className="mt-1 text-xl font-bold text-orange-600">{inr(summary?.platformFee)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5" /> Avg order value
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">{inr(summary?.aov)}</p>
              </CardContent>
            </Card>
            <Card className="col-span-2 md:col-span-1">
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
                  <Building2 className="h-3.5 w-3.5" /> Branches with sales
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">{summary?.branchCount ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          {/* Branch-wise totals (sortable) */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Branch-wise performance</h2>
                <Badge variant="outline">{branchRows.length} row(s)</Badge>
              </div>
              {branchRows.length === 0 ? (
                <EmptyState
                  icon={<Building2 className="h-6 w-6" />}
                  title="No sales in this range"
                  description="Try widening the date range."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                        <th
                          className="cursor-pointer py-2 pr-3"
                          onClick={() => branchSort.toggle('branchName')}
                        >
                          Branch{branchSort.icon('branchName')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3 text-right"
                          onClick={() => branchSort.toggle('orders')}
                        >
                          Orders{branchSort.icon('orders')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3 text-right"
                          onClick={() => branchSort.toggle('revenue')}
                        >
                          Revenue{branchSort.icon('revenue')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3 text-right"
                          onClick={() => branchSort.toggle('platformFee')}
                        >
                          Platform fee{branchSort.icon('platformFee')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3 text-right"
                          onClick={() => branchSort.toggle('aov')}
                        >
                          AOV{branchSort.icon('aov')}
                        </th>
                        <th
                          className="cursor-pointer py-2 text-right"
                          onClick={() => branchSort.toggle('share')}
                        >
                          Share{branchSort.icon('share')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchSort.sorted.map((b: any) => (
                        <tr key={b.branchId || 'unassigned'} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium text-slate-800">{b.branchName}</td>
                          <td className="py-2 pr-3 text-right">{b.orders}</td>
                          <td className="py-2 pr-3 text-right font-semibold">{inr(b.revenue)}</td>
                          <td className="py-2 pr-3 text-right text-orange-600">{inr(b.platformFee)}</td>
                          <td className="py-2 pr-3 text-right">{inr(b.aov)}</td>
                          <td className="py-2 text-right">{b.share}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Collapsible period groups (sortable) */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">
                  {groupBy === 'day' ? 'Day-wise' : 'Month-wise'} breakdown
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setOpenPeriods(allOpen ? new Set() : new Set(periodRows.map((p: any) => p.key)))
                  }
                >
                  {allOpen ? 'Collapse all' : 'Expand all'}
                  {allOpen ? (
                    <ChevronUp className="ml-1 h-4 w-4" />
                  ) : (
                    <ChevronDown className="ml-1 h-4 w-4" />
                  )}
                </Button>
              </div>
              {periodRows.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="h-6 w-6" />}
                  title="Nothing to break down yet"
                  description="No orders were placed in this date range."
                />
              ) : (
                <div className="space-y-2">
                  {periodSort.sorted.map((p: any) => {
                    const open = openPeriods.has(p.key)
                    return (
                      <Collapsible key={p.key} open={open} onOpenChange={() => togglePeriod(p.key)}>
                        <div className="rounded-lg border border-slate-200">
                          <CollapsibleTrigger asChild>
                            <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
                              {open ? (
                                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                              )}
                              <span className="font-semibold text-slate-800">{p.label}</span>
                              <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                <span className="text-slate-500">
                                  {p.orders} order{p.orders === 1 ? '' : 's'}
                                </span>
                                <span className="font-semibold text-slate-900">{inr(p.revenue)}</span>
                                <span className="text-xs text-orange-600">
                                  fee {inr(p.platformFee)}
                                </span>
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t border-slate-100 px-3 py-3">
                              {/* per-branch rows inside the period */}
                              {p.branches.length > 0 ? (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                                      <th className="py-1 pr-3">Branch</th>
                                      <th className="py-1 pr-3 text-right">Orders</th>
                                      <th className="py-1 pr-3 text-right">Revenue</th>
                                      <th className="py-1 pr-3 text-right">Net revenue</th>
                                      <th className="py-1 text-right">Platform fee</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.branches.map((b: any) => (
                                      <tr
                                        key={b.branchId || 'unassigned'}
                                        className="border-t border-slate-50"
                                      >
                                        <td className="py-1.5 pr-3 text-slate-700">
                                          {b.branchName}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right">{b.orders}</td>
                                        <td className="py-1.5 pr-3 text-right font-medium">
                                          {inr(b.revenue)}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right">{inr(b.netRevenue)}</td>
                                        <td className="py-1.5 text-right text-orange-600">
                                          {inr(b.platformFee)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : null}
                              {/* top products inside the period */}
                              {p.topProducts.length > 0 ? (
                                <div className="mt-3">
                                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    <Package className="h-3 w-3" /> Top products
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.topProducts.map((prod: any) => (
                                      <Badge
                                        key={prod.id}
                                        variant="outline"
                                        className="gap-1 font-normal"
                                      >
                                        {prod.name} · {prod.qty}× · {inr(prod.revenue)}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product sales (sortable, branch-attributed) */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <UtensilsCrossed className="h-4 w-4" /> Product sales
                </h2>
                <Badge variant="outline">{productRows.length} row(s)</Badge>
              </div>
              {productRows.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-6 w-6" />}
                  title="No products sold in this range"
                  description="Product performance appears once orders come in."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                        <th
                          className="cursor-pointer py-2 pr-3"
                          onClick={() => productSort.toggle('name')}
                        >
                          Product{productSort.icon('name')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3"
                          onClick={() => productSort.toggle('branchName')}
                        >
                          Branch{productSort.icon('branchName')}
                        </th>
                        <th
                          className="cursor-pointer py-2 pr-3 text-right"
                          onClick={() => productSort.toggle('qty')}
                        >
                          Qty sold{productSort.icon('qty')}
                        </th>
                        <th
                          className="cursor-pointer py-2 text-right"
                          onClick={() => productSort.toggle('revenue')}
                        >
                          Revenue{productSort.icon('revenue')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {productSort.sorted.map((p: any) => (
                        <tr key={`${p.id}-${p.branchId || 'unassigned'}`} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium text-slate-800">{p.name}</td>
                          <td className="py-2 pr-3 text-slate-500">{p.branchName}</td>
                          <td className="py-2 pr-3 text-right">{p.qty}</td>
                          <td className="py-2 text-right font-semibold">{inr(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
