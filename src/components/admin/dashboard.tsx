'use client'

import { useAdminDashboard } from '@/hooks/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Price, formatINR } from '@/components/restaurant/price'
import { LoadingSpinner, EmptyState, SkeletonCard } from '@/components/restaurant/loading-states'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { useUpdateOrderStatus } from '@/hooks/api'
import { IndianRupee, ShoppingBag, TrendingUp, Clock, ChefHat, CheckCircle2, BellRing, XCircle } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { PlatformFeeAlertBanner } from './platform-fee-alert-banner'

export function Dashboard() {
  const { data, isLoading, error } = useAdminDashboard()
  const updateStatus = useUpdateOrderStatus()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4">
        <EmptyState
          title="Couldn't load dashboard"
          description={(error as Error).message}
        />
      </div>
    )
  }
  if (!data) return null

  const kpis = [
    {
      label: "Today's sales",
      value: formatINR(data.todaySales),
      icon: IndianRupee,
      tint: 'bg-orange-100 text-orange-700',
    },
    {
      label: 'Orders today',
      value: data.todayOrderCount,
      icon: ShoppingBag,
      tint: 'bg-amber-100 text-amber-700',
    },
    {
      label: 'Avg order value',
      value: formatINR(data.aov),
      icon: TrendingUp,
      tint: 'bg-green-100 text-green-700',
    },
    {
      label: 'Pending in kitchen',
      value: (data.statusCounts.NEW || 0) + (data.statusCounts.PREPARING || 0),
      icon: Clock,
      tint: 'bg-purple-100 text-purple-700',
    },
  ]

  const statusCards = [
    { label: 'New', value: data.statusCounts.NEW || 0, icon: BellRing, color: 'text-blue-600' },
    { label: 'Preparing', value: data.statusCounts.PREPARING || 0, icon: ChefHat, color: 'text-orange-600' },
    { label: 'Ready', value: data.statusCounts.READY || 0, icon: CheckCircle2, color: 'text-green-600' },
    { label: 'Completed', value: data.statusCounts.COMPLETED || 0, icon: CheckCircle2, color: 'text-slate-600' },
    { label: 'Cancelled', value: data.statusCounts.CANCELLED || 0, icon: XCircle, color: 'text-red-600' },
  ]

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <PlatformFeeAlertBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{kpi.label}</p>
                      <p className="text-xl font-bold lg:text-2xl">{kpi.value}</p>
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${kpi.tint}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statusCards.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 p-3">
                <Icon className={`h-5 w-5 ${s.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Revenue · last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.days}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA580C" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#EA580C" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: any) => [formatINR(v), 'Revenue']}
                    labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#EA580C"
                    strokeWidth={2}
                    fill="url(#revGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top items today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topItems.length === 0 && (
              <p className="text-sm text-muted-foreground">No orders yet today.</p>
            )}
            {data.topItems.map((item: any, idx: number) => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium line-clamp-1">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.quantity} sold</p>
                </div>
                <span className="text-sm font-semibold">{formatINR(item.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Link
            href="/#orders"
            className="text-xs text-orange-600 hover:underline"
          >
            View all →
          </Link>
        </CardHeader>
        <CardContent>
          {data.recentOrders.length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="New customer orders will appear here in real-time."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Order</th>
                    <th className="py-2 pr-2">Table</th>
                    <th className="py-2 pr-2">Items</th>
                    <th className="py-2 pr-2">Total</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((o: any) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">{o.orderNumber}</td>
                      <td className="py-2 pr-2">{o.tableNumber}</td>
                      <td className="py-2 pr-2">{o.itemCount}</td>
                      <td className="py-2 pr-2 font-semibold">{formatINR(o.grandTotal)}</td>
                      <td className="py-2 pr-2">
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className="py-2 pr-2">
                        {o.status === 'NEW' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updateStatus.isPending}
                            onClick={async () => {
                              try {
                                await updateStatus.mutateAsync({ id: o.id, status: 'ACCEPTED' })
                                toast.success('Order accepted')
                              } catch (err: any) {
                                toast.error(err.message || 'Failed')
                              }
                            }}
                          >
                            Accept
                          </Button>
                        )}
                        {o.status === 'ACCEPTED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updateStatus.isPending}
                            onClick={async () => {
                              try {
                                await updateStatus.mutateAsync({ id: o.id, status: 'PREPARING' })
                                toast.success('Marked as preparing')
                              } catch (err: any) {
                                toast.error(err.message || 'Failed')
                              }
                            }}
                          >
                            Start
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
