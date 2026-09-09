'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
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
import { LoadingSpinner, EmptyState } from '@/components/restaurant/loading-states'
import { formatINR } from '@/lib/format'
import {
  TrendingUp,
  ShoppingBag,
  PieChart as PieChartIcon,
  CreditCard,
  Download,
  Calendar as CalendarIcon,
  IndianRupee,
  Package,
  Percent,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { toast } from 'sonner'

const PIE_COLORS = ['#EA580C', '#16A34A', '#9333EA', '#0EA5E9', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1']

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
]

type GroupBy = 'day' | 'month'
type SortDir = 'asc' | 'desc'

// ----------------------------------------------------------------------------
// Generic sort helper — works on any row type. Compares strings via
// localeCompare (correct for ISO date strings like YYYY-MM-DD / YYYY-MM) and
// numbers numerically.
// ----------------------------------------------------------------------------
function sortRows<T>(rows: T[], sortKey: string, sortDir: SortDir): T[] {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
     
    const av = (a as any)[sortKey]
     
    const bv = (b as any)[sortKey]
    if (typeof av === 'string' && typeof bv === 'string') {
      // ISO date strings (YYYY-MM-DD or YYYY-MM) sort correctly via localeCompare
      return av.localeCompare(bv) * dir
    }
    const an = Number(av ?? 0)
    const bn = Number(bv ?? 0)
    return (an - bn) * dir
  })
}

// ----------------------------------------------------------------------------
// Sort hook — Excel-style toggle (click active column flips direction,
// click a new column defaults to ascending).
// ----------------------------------------------------------------------------
function useSort(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<string>(defaultKey)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return { sortKey, sortDir, toggleSort }
}

function getMonthKey(dateStr: string): string {
  // Accepts YYYY-MM-DD or any ISO date; returns YYYY-MM
  return dateStr.slice(0, 7)
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function ReportsManager() {
  const [range, setRange] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [tab, setTab] = useState('sales')
  const [groupBy, setGroupBy] = useState<GroupBy>('day')

  const queryString =
    range === 'custom' && customFrom && customTo
      ? `range=custom&from=${customFrom}&to=${customTo}&groupBy=${groupBy}`
      : `range=${range}&groupBy=${groupBy}`

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revenue Reports</h1>
          <p className="text-sm text-muted-foreground">
            Sales, products, categories, and payment collections
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const from = range === 'custom' ? customFrom : ''
            const to = range === 'custom' ? customTo : ''
            const params = new URLSearchParams({ range, from, to, format: 'csv' })
            window.open(`/api/admin/reports/export?${params}`, '_blank')
            toast.success('CSV export ready')
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-xs">Date range</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[180px]">
                <CalendarIcon className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Group by</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-[140px]">
                <CalendarIcon className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {range === 'custom' && (
            <>
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[160px]" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[160px]" />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="sales"><TrendingUp className="mr-2 h-4 w-4" />Sales</TabsTrigger>
          <TabsTrigger value="products"><Package className="mr-2 h-4 w-4" />Products</TabsTrigger>
          <TabsTrigger value="categories"><PieChartIcon className="mr-2 h-4 w-4" />Categories</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="mr-2 h-4 w-4" />Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <SalesReport queryString={queryString} groupBy={groupBy} />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <ProductsReport queryString={queryString} />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesReport queryString={queryString} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsReport queryString={queryString} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// SALES REPORT
// ============================================================================

interface SalesRow {
  date: string
  orders: number
  grossSales: number
  discount: number
  refund: number
  netSales: number
  tax: number
  platformFee: number
  total: number
}

interface SalesMonthGroup {
  monthKey: string // YYYY-MM
  agg: SalesRow // date field set to monthKey for sort compatibility
  days: SalesRow[]
}

function aggregateSalesByMonth(rows: SalesRow[]): SalesMonthGroup[] {
  const map = new Map<string, SalesRow[]>()
  for (const r of rows) {
    const mk = getMonthKey(r.date)
    if (!map.has(mk)) map.set(mk, [])
    map.get(mk)!.push(r)
  }
  const groups: SalesMonthGroup[] = []
  for (const [monthKey, days] of Array.from(map.entries())) {
    // Days within a month are always shown chronologically (date asc)
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const agg: SalesRow = sortedDays.reduce(
      (acc, r) => ({
        date: monthKey,
        orders: acc.orders + r.orders,
        grossSales: acc.grossSales + r.grossSales,
        discount: acc.discount + r.discount,
        refund: acc.refund + r.refund,
        netSales: acc.netSales + r.netSales,
        tax: acc.tax + r.tax,
        platformFee: acc.platformFee + r.platformFee,
        total: acc.total + r.total,
      }),
      { date: monthKey, orders: 0, grossSales: 0, discount: 0, refund: 0, netSales: 0, tax: 0, platformFee: 0, total: 0 },
    )
    groups.push({ monthKey, agg, days: sortedDays })
  }
  return groups
}

function SalesReport({ queryString, groupBy }: { queryString: string; groupBy: GroupBy }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-sales', queryString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/sales?${queryString}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load sales report')
      const json = await res.json()
      return json.data as {
        range: string
        rows: SalesRow[]
        platformFeeBreakdown: {
          totalCollected: number
          totalPending: number
          restaurantPortion: number
          customerPortion: number
        }
        summary: SalesRow & { aov: number }
      }
    },
  })

  const { sortKey, sortDir, toggleSort } = useSort('date', 'desc')
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())

  // Month groups (memoized so the order stays stable across re-renders)
  const monthGroups = useMemo<SalesMonthGroup[]>(() => {
    if (!data) return []
    return aggregateSalesByMonth(data.rows)
  }, [data])

  // Sorted month aggregations (we sort the agg row, then look up its group)
  const sortedMonthGroups = useMemo<SalesMonthGroup[]>(() => {
    if (monthGroups.length === 0) return []
    const sortedAggs = sortRows(monthGroups.map((g) => g.agg), sortKey, sortDir)
    return sortedAggs
      .map((agg) => monthGroups.find((g) => g.monthKey === agg.date))
      .filter((g): g is SalesMonthGroup => Boolean(g))
  }, [monthGroups, sortKey, sortDir])

  // Sorted day rows (for day view)
  const sortedDayRows = useMemo<SalesRow[]>(() => {
    if (!data) return []
    return sortRows(data.rows, sortKey, sortDir)
  }, [data, sortKey, sortDir])

  const allMonthsExpanded =
    monthGroups.length > 0 && monthGroups.every((g) => expandedMonths.has(g.monthKey))

  const toggleAllMonths = () => {
    if (allMonthsExpanded) {
      setExpandedMonths(new Set())
    } else {
      setExpandedMonths(new Set(monthGroups.map((g) => g.monthKey)))
    }
  }

  const toggleOneMonth = (monthKey: string, open: boolean) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (open) next.add(monthKey)
      else next.delete(monthKey)
      return next
    })
  }

  if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
  if (isError) return <EmptyState title="Couldn't load sales report" />
  if (!data) return null

  const chartData = data.rows.map((r) => ({
    date: new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    total: r.total,
    net: r.netSales,
    orders: r.orders,
  }))

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Total revenue" value={formatINR(data.summary.total)} icon={<IndianRupee className="h-4 w-4" />} tone="orange" />
        <KpiCard label="Orders" value={String(data.summary.orders)} icon={<ShoppingBag className="h-4 w-4" />} tone="blue" />
        <KpiCard label="Avg order value" value={formatINR(data.summary.aov)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <KpiCard label="Tax collected" value={formatINR(data.summary.tax)} icon={<CreditCard className="h-4 w-4" />} tone="purple" />
        <KpiCard label="Platform fee" value={formatINR(data.summary.platformFee)} icon={<Percent className="h-4 w-4" />} tone="red" />
      </div>

      {/* Platform fee breakdown */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold text-orange-700">Platform fee breakdown</span>
            <span>
              <span className="text-muted-foreground">Collected:</span>{' '}
              <span className="font-bold">{formatINR(data.platformFeeBreakdown.totalCollected)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Pending:</span>{' '}
              <span className="font-bold">{formatINR(data.platformFeeBreakdown.totalPending)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Restaurant portion:</span>{' '}
              <span className="font-bold">{formatINR(data.platformFeeBreakdown.restaurantPortion)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Customer portion:</span>{' '}
              <span className="font-bold">{formatINR(data.platformFeeBreakdown.customerPortion)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Sales breakdown
              {groupBy === 'month' && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">(by month — click a row to expand)</span>
              )}
            </CardTitle>
            {groupBy === 'month' && monthGroups.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleAllMonths}>
                {allMonthsExpanded ? (
                  <><ChevronUp className="mr-2 h-4 w-4" />Collapse all</>
                ) : (
                  <><ChevronDown className="mr-2 h-4 w-4" />Expand all</>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <SortableTh sortKey="date" activeKey={sortKey} direction={sortDir} onSort={toggleSort}>
                    {groupBy === 'month' ? 'Month' : 'Date'}
                  </SortableTh>
                  <SortableTh sortKey="orders" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Orders</SortableTh>
                  <SortableTh sortKey="grossSales" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Gross Sales</SortableTh>
                  <SortableTh sortKey="discount" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Discount</SortableTh>
                  <SortableTh sortKey="refund" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Refund</SortableTh>
                  <SortableTh sortKey="netSales" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Net Sales</SortableTh>
                  <SortableTh sortKey="tax" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Tax</SortableTh>
                  <SortableTh sortKey="platformFee" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Platform Fee</SortableTh>
                  <SortableTh sortKey="total" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Total</SortableTh>
                </tr>
              </thead>

              {groupBy === 'month' ? (
                sortedMonthGroups.length === 0 ? (
                  <tbody>
                    <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No sales in this range</td></tr>
                  </tbody>
                ) : (
                  sortedMonthGroups.map((group) => {
                    const isOpen = expandedMonths.has(group.monthKey)
                    return (
                      <Collapsible
                        key={group.monthKey}
                        asChild
                        open={isOpen}
                        onOpenChange={(open) => toggleOneMonth(group.monthKey, open)}
                      >
                        <tbody className="group">
                          <CollapsibleTrigger asChild>
                            <tr className="cursor-pointer border-b last:border-0 hover:bg-slate-50">
                              <Td>
                                <span className="inline-flex items-center gap-1.5 font-semibold">
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  {formatMonthLabel(group.monthKey)}
                                </span>
                              </Td>
                              <Td align="right">{group.agg.orders}</Td>
                              <Td align="right">{formatINR(group.agg.grossSales)}</Td>
                              <Td align="right" className="text-red-600">{group.agg.discount > 0 ? `-${formatINR(group.agg.discount)}` : '—'}</Td>
                              <Td align="right" className="text-red-600">{group.agg.refund > 0 ? `-${formatINR(group.agg.refund)}` : '—'}</Td>
                              <Td align="right" className="font-medium">{formatINR(group.agg.netSales)}</Td>
                              <Td align="right">{formatINR(group.agg.tax)}</Td>
                              <Td align="right" className="text-orange-700">{group.agg.platformFee > 0 ? formatINR(group.agg.platformFee) : '—'}</Td>
                              <Td align="right" className="font-bold">{formatINR(group.agg.total)}</Td>
                            </tr>
                          </CollapsibleTrigger>

                          {group.days.map((day) => (
                            <CollapsibleContent asChild key={day.date}>
                              <tr className="border-b bg-slate-50/60 text-xs last:border-0">
                                <Td>
                                  <span className="ml-6 inline-flex items-center gap-1 text-muted-foreground">
                                    <span className="text-slate-400">↳</span>
                                    {new Date(day.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                </Td>
                                <Td align="right">{day.orders}</Td>
                                <Td align="right">{formatINR(day.grossSales)}</Td>
                                <Td align="right" className="text-red-600">{day.discount > 0 ? `-${formatINR(day.discount)}` : '—'}</Td>
                                <Td align="right" className="text-red-600">{day.refund > 0 ? `-${formatINR(day.refund)}` : '—'}</Td>
                                <Td align="right" className="font-medium">{formatINR(day.netSales)}</Td>
                                <Td align="right">{formatINR(day.tax)}</Td>
                                <Td align="right" className="text-orange-700">{day.platformFee > 0 ? formatINR(day.platformFee) : '—'}</Td>
                                <Td align="right" className="font-semibold">{formatINR(day.total)}</Td>
                              </tr>
                            </CollapsibleContent>
                          ))}
                        </tbody>
                      </Collapsible>
                    )
                  })
                )
              ) : (
                <tbody>
                  {sortedDayRows.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No sales in this range</td></tr>
                  ) : (
                    sortedDayRows.map((r) => (
                      <tr key={r.date} className="border-b last:border-0 hover:bg-slate-50">
                        <Td>{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                        <Td align="right">{r.orders}</Td>
                        <Td align="right">{formatINR(r.grossSales)}</Td>
                        <Td align="right" className="text-red-600">{r.discount > 0 ? `-${formatINR(r.discount)}` : '—'}</Td>
                        <Td align="right" className="text-red-600">{r.refund > 0 ? `-${formatINR(r.refund)}` : '—'}</Td>
                        <Td align="right" className="font-medium">{formatINR(r.netSales)}</Td>
                        <Td align="right">{formatINR(r.tax)}</Td>
                        <Td align="right" className="text-orange-700">{r.platformFee > 0 ? formatINR(r.platformFee) : '—'}</Td>
                        <Td align="right" className="font-bold">{formatINR(r.total)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              )}

              <tfoot className="border-t-2 bg-orange-50 font-bold">
                <tr>
                  <Td>Total</Td>
                  <Td align="right">{data.summary.orders}</Td>
                  <Td align="right">{formatINR(data.summary.grossSales)}</Td>
                  <Td align="right" className="text-red-600">{data.summary.discount > 0 ? `-${formatINR(data.summary.discount)}` : '—'}</Td>
                  <Td align="right" className="text-red-600">{data.summary.refund > 0 ? `-${formatINR(data.summary.refund)}` : '—'}</Td>
                  <Td align="right">{formatINR(data.summary.netSales)}</Td>
                  <Td align="right">{formatINR(data.summary.tax)}</Td>
                  <Td align="right" className="text-orange-700">{data.summary.platformFee > 0 ? formatINR(data.summary.platformFee) : '—'}</Td>
                  <Td align="right">{formatINR(data.summary.total)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// PRODUCTS REPORT
// ============================================================================

interface ProductRow {
  menuItemId: string
  name: string
  image: string | null
  isVeg: boolean
  isSpicy: boolean
  categoryName: string | null
  quantity: number
  grossSales: number
  discount: number
  netSales: number
  platformFee: number
}

function ProductsReport({ queryString }: { queryString: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-products', queryString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/products?${queryString}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load products report')
      const json = await res.json()
      return json.data as {
        range: string
        items: ProductRow[]
        topSelling: ProductRow[]
        topRevenue: ProductRow[]
        summary: { totalItems: number; totalQuantity: number; totalGrossSales: number; totalDiscount: number; totalNetSales: number; totalPlatformFee: number }
      }
    },
  })

  const { sortKey, sortDir, toggleSort } = useSort('quantity', 'desc')

  const sortedItems = useMemo<ProductRow[]>(() => {
    if (!data) return []
    return sortRows(data.items, sortKey, sortDir)
  }, [data, sortKey, sortDir])

  if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
  if (isError) return <EmptyState title="Couldn't load products report" />
  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Items sold" value={String(data.summary.totalQuantity)} icon={<Package className="h-4 w-4" />} tone="orange" />
        <KpiCard label="Unique items" value={String(data.summary.totalItems)} icon={<Package className="h-4 w-4" />} tone="blue" />
        <KpiCard label="Gross sales" value={formatINR(data.summary.totalGrossSales)} icon={<IndianRupee className="h-4 w-4" />} tone="green" />
        <KpiCard label="Net sales" value={formatINR(data.summary.totalNetSales)} icon={<TrendingUp className="h-4 w-4" />} tone="purple" />
        <KpiCard label="Platform fee" value={formatINR(data.summary.totalPlatformFee)} icon={<Percent className="h-4 w-4" />} tone="red" />
      </div>

      {/* Top rankings */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🏆 Top selling (by qty)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topSelling.map((item, i) => (
                <div key={item.menuItemId} className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{item.quantity} qty</p>
                    <p className="text-xs text-muted-foreground">{formatINR(item.netSales)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">💰 Top revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topRevenue.map((item, i) => (
                <div key={item.menuItemId} className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-700">{formatINR(item.netSales)}</p>
                    <p className="text-xs text-muted-foreground">{item.quantity} qty</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Full table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <SortableTh sortKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort}>Item</SortableTh>
                  <SortableTh sortKey="categoryName" activeKey={sortKey} direction={sortDir} onSort={toggleSort}>Category</SortableTh>
                  <SortableTh sortKey="quantity" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Qty</SortableTh>
                  <SortableTh sortKey="grossSales" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Gross Sales</SortableTh>
                  <SortableTh sortKey="discount" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Discount</SortableTh>
                  <SortableTh sortKey="netSales" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Net Sales</SortableTh>
                  <SortableTh sortKey="platformFee" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Platform Fee</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedItems.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No items sold in this range</td></tr>
                ) : (
                  sortedItems.map((item) => (
                    <tr key={item.menuItemId} className="border-b last:border-0 hover:bg-slate-50">
                      <Td>
                        <div className="flex items-center gap-2">
                          {item.image && <img src={item.image} alt="" className="h-8 w-8 rounded object-cover" />}
                          <div>
                            <p className="font-medium">{item.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {item.isVeg ? '🟢 Veg' : '🔴 Non-veg'} {item.isSpicy && '· 🌶 Spicy'}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td>{item.categoryName || '—'}</Td>
                      <Td align="right" className="font-medium">{item.quantity}</Td>
                      <Td align="right">{formatINR(item.grossSales)}</Td>
                      <Td align="right" className="text-red-600">{item.discount > 0 ? `-${formatINR(item.discount)}` : '—'}</Td>
                      <Td align="right" className="font-bold">{formatINR(item.netSales)}</Td>
                      <Td align="right" className="text-orange-700">{item.platformFee > 0 ? formatINR(item.platformFee) : '—'}</Td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t-2 bg-orange-50 font-bold">
                <tr>
                  <Td>Total</Td>
                  <Td>—</Td>
                  <Td align="right">{data.summary.totalQuantity}</Td>
                  <Td align="right">{formatINR(data.summary.totalGrossSales)}</Td>
                  <Td align="right" className="text-red-600">{data.summary.totalDiscount > 0 ? `-${formatINR(data.summary.totalDiscount)}` : '—'}</Td>
                  <Td align="right">{formatINR(data.summary.totalNetSales)}</Td>
                  <Td align="right" className="text-orange-700">{data.summary.totalPlatformFee > 0 ? formatINR(data.summary.totalPlatformFee) : '—'}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// CATEGORIES REPORT
// ============================================================================

interface CategoryRow {
  categoryId: string
  name: string
  icon: string | null
  quantity: number
  revenue: number
  platformFee: number
  percentage: number
}

function CategoriesReport({ queryString }: { queryString: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-categories', queryString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/categories?${queryString}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load categories report')
      const json = await res.json()
      return json.data as {
        range: string
        categories: CategoryRow[]
        totalRevenue: number
        totalPlatformFee: number
        totalQuantity: number
      }
    },
  })

  const { sortKey, sortDir, toggleSort } = useSort('revenue', 'desc')

  const sortedCategories = useMemo<CategoryRow[]>(() => {
    if (!data) return []
    return sortRows(data.categories, sortKey, sortDir)
  }, [data, sortKey, sortDir])

  if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
  if (isError) return <EmptyState title="Couldn't load categories report" />
  if (!data) return null

  // Pie chart uses original ordering (by revenue desc) for stable colour assignment
  const chartData = data.categories.map((c) => ({
    name: c.name,
    revenue: c.revenue,
    percentage: c.percentage,
  }))

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard label="Total revenue" value={formatINR(data.totalRevenue)} icon={<IndianRupee className="h-4 w-4" />} tone="orange" />
        <KpiCard label="Items sold" value={String(data.totalQuantity)} icon={<Package className="h-4 w-4" />} tone="green" />
        <KpiCard label="Categories" value={String(data.categories.length)} icon={<PieChartIcon className="h-4 w-4" />} tone="purple" />
        <KpiCard label="Platform fee" value={formatINR(data.totalPlatformFee)} icon={<Percent className="h-4 w-4" />} tone="red" />
      </div>

      <div className="grid gap-4 grid-cols-1">
        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="revenue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e: any) => `${e.percentage}%`}
                  >
                    {chartData.map((_, i) => (
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

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <SortableTh sortKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort}>Category</SortableTh>
                  <SortableTh sortKey="quantity" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Qty</SortableTh>
                  <SortableTh sortKey="revenue" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Revenue</SortableTh>
                  <SortableTh sortKey="platformFee" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Platform Fee</SortableTh>
                  <SortableTh sortKey="percentage" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Share</SortableTh>
                  <Th>Distribution</Th>
                </tr>
              </thead>
              <tbody>
                {sortedCategories.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No category sales in this range</td></tr>
                ) : (
                  sortedCategories.map((c) => {
                    // Stable colour based on the original category index in the API response
                    const originalIdx = data.categories.findIndex((x) => x.categoryId === c.categoryId)
                    const colour = PIE_COLORS[(originalIdx < 0 ? 0 : originalIdx) % PIE_COLORS.length]
                    return (
                      <tr key={c.categoryId} className="border-b last:border-0 hover:bg-slate-50">
                        <Td>
                          <span className="mr-2">{c.icon}</span>
                          <span className="font-medium">{c.name}</span>
                        </Td>
                        <Td align="right">{c.quantity}</Td>
                        <Td align="right" className="font-bold">{formatINR(c.revenue)}</Td>
                        <Td align="right" className="text-orange-700">{c.platformFee > 0 ? formatINR(c.platformFee) : '—'}</Td>
                        <Td align="right">
                          <Badge variant="outline" className="font-bold">
                            {c.percentage}%
                          </Badge>
                        </Td>
                        <Td>
                          <div className="h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${c.percentage}%`, backgroundColor: colour }}
                            />
                          </div>
                        </Td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              <tfoot className="border-t-2 bg-orange-50 font-bold">
                <tr>
                  <Td>Total</Td>
                  <Td align="right">{data.totalQuantity}</Td>
                  <Td align="right">{formatINR(data.totalRevenue)}</Td>
                  <Td align="right" className="text-orange-700">{data.totalPlatformFee > 0 ? formatINR(data.totalPlatformFee) : '—'}</Td>
                  <Td align="right">100%</Td>
                  <Td>—</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// PAYMENTS REPORT
// ============================================================================

interface PaymentMethodRow {
  method: string
  collected: number
  pending: number
  failed: number
  refunded: number
  count: number
  total: number
}

function PaymentsReport({ queryString }: { queryString: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-payments', queryString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/payments?${queryString}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load payments report')
      const json = await res.json()
      return json.data as {
        range: string
        byMethod: PaymentMethodRow[]
        byStatus: {
          successful: { amount: number; count: number }
          pending: { amount: number; count: number }
          failed: { amount: number; count: number }
          refunded: { amount: number; count: number }
        }
        collected: number
        pending: number
        failed: number
        refunded: number
        totalOrders: number
      }
    },
  })

  const { sortKey, sortDir, toggleSort } = useSort('collected', 'desc')

  const sortedByMethod = useMemo<PaymentMethodRow[]>(() => {
    if (!data) return []
    return sortRows(data.byMethod, sortKey, sortDir)
  }, [data, sortKey, sortDir])

  if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
  if (isError) return <EmptyState title="Couldn't load payments report" />
  if (!data) return null

  const methodLabels: Record<string, string> = {
    UPI: 'UPI',
    CARD: 'Card',
    CASH: 'Cash',
    COUNTER: 'Pay at Counter',
    WALLET: 'Wallet',
  }

  const statusData = [
    { name: 'Successful', value: data.byStatus.successful.amount, count: data.byStatus.successful.count, color: '#16A34A' },
    { name: 'Pending', value: data.byStatus.pending.amount, count: data.byStatus.pending.count, color: '#F59E0B' },
    { name: 'Failed', value: data.byStatus.failed.amount, count: data.byStatus.failed.count, color: '#EF4444' },
    { name: 'Refunded', value: data.byStatus.refunded.amount, count: data.byStatus.refunded.count, color: '#9333EA' },
  ]

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Collected" value={formatINR(data.collected)} icon={<IndianRupee className="h-4 w-4" />} tone="green" />
        <KpiCard label="Pending" value={formatINR(data.pending)} icon={<CreditCard className="h-4 w-4" />} tone="orange" />
        <KpiCard label="Failed" value={formatINR(data.failed)} icon={<CreditCard className="h-4 w-4" />} tone="red" />
        <KpiCard label="Refunded" value={formatINR(data.refunded)} icon={<CreditCard className="h-4 w-4" />} tone="purple" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* By Method table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment & Collection by method</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sortedByMethod.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payment activity in this range</p>
              ) : (
                sortedByMethod.map((m) => (
                  <div key={m.method} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-semibold">{methodLabels[m.method] || m.method}</p>
                      <p className="text-xs text-muted-foreground">{m.count} transactions</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-700">{formatINR(m.collected)}</p>
                      {m.pending > 0 && <p className="text-[10px] text-amber-600">pending {formatINR(m.pending)}</p>}
                      {m.refunded > 0 && <p className="text-[10px] text-purple-600">refunded {formatINR(m.refunded)}</p>}
                    </div>
                  </div>
                ))
              )}
              {sortedByMethod.length > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 p-3 border-2 border-emerald-200">
                  <p className="text-sm font-bold text-emerald-900">Total Collected</p>
                  <p className="text-xl font-extrabold text-emerald-700">{formatINR(data.collected)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status breakdown pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e: any) => e.count > 0 ? `${e.name}: ${e.count}` : ''}
                  >
                    {statusData.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                    formatter={(v: number) => formatINR(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {statusData.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-auto font-bold">{formatINR(s.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Full method table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detailed breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left">
                <tr>
                  <SortableTh sortKey="method" activeKey={sortKey} direction={sortDir} onSort={toggleSort}>Method</SortableTh>
                  <SortableTh sortKey="count" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Transactions</SortableTh>
                  <SortableTh sortKey="collected" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Successful</SortableTh>
                  <SortableTh sortKey="pending" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Pending</SortableTh>
                  <SortableTh sortKey="failed" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Failed</SortableTh>
                  <SortableTh sortKey="refunded" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Refunded</SortableTh>
                  <SortableTh sortKey="total" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right">Total</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedByMethod.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No payment activity in this range</td></tr>
                ) : (
                  sortedByMethod.map((m) => (
                    <tr key={m.method} className="border-b last:border-0 hover:bg-slate-50">
                      <Td className="font-medium">{methodLabels[m.method] || m.method}</Td>
                      <Td align="right">{m.count}</Td>
                      <Td align="right" className="font-medium text-emerald-700">{formatINR(m.collected)}</Td>
                      <Td align="right" className="text-amber-600">{m.pending > 0 ? formatINR(m.pending) : '—'}</Td>
                      <Td align="right" className="text-red-600">{m.failed > 0 ? formatINR(m.failed) : '—'}</Td>
                      <Td align="right" className="text-purple-600">{m.refunded > 0 ? formatINR(m.refunded) : '—'}</Td>
                      <Td align="right" className="font-bold">{formatINR(m.total)}</Td>
                    </tr>
                  ))
                )}
              </tbody>
              {sortedByMethod.length > 0 && (
                <tfoot className="border-t-2 bg-orange-50 font-bold">
                  <tr>
                    <Td>Total</Td>
                    <Td align="right">{sortedByMethod.reduce((s, m) => s + m.count, 0)}</Td>
                    <Td align="right" className="text-emerald-700">{formatINR(data.collected)}</Td>
                    <Td align="right" className="text-amber-600">{formatINR(data.pending)}</Td>
                    <Td align="right" className="text-red-600">{formatINR(data.failed)}</Td>
                    <Td align="right" className="text-purple-600">{formatINR(data.refunded)}</Td>
                    <Td align="right">{formatINR(data.collected + data.pending + data.failed + data.refunded)}</Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: 'orange' | 'green' | 'blue' | 'purple' | 'red'
}) {
  const toneClass = {
    orange: 'bg-orange-50 text-orange-700',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    purple: 'bg-violet-50 text-violet-700',
    red: 'bg-red-50 text-red-700',
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

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  )
}

function SortableTh({
  children,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
}: {
  children: React.ReactNode
  sortKey: string
  activeKey: string
  direction: SortDir
  onSort: (key: string) => void
  align?: 'left' | 'right'
}) {
  const isActive = sortKey === activeKey
  return (
    <th
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none cursor-pointer hover:bg-slate-100 transition-colors ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span>{children}</span>
        {isActive ? (
          direction === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-orange-600" />
          ) : (
            <ArrowDown className="h-3 w-3 text-orange-600" />
          )
        ) : (
          <span className="inline-flex h-3 w-3 flex-col items-center justify-center opacity-0 group-hover:opacity-30">
            {/* spacer keeps column widths stable when sort is inactive */}
          </span>
        )}
      </span>
    </th>
  )
}

function Td({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <td className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  )
}
