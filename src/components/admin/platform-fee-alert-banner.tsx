'use client'

/**
 * PlatformFeeAlertBanner
 *
 * Shown at the top of the admin Dashboard when the tenant has overdue or
 * blocked-status platform fees. Clicking "Pay now" navigates to
 * Settings → Platform fees tab (hash routing).
 *
 * Realtime-aware: refetches when `platform:feePaid` or
 * `platform:feeCollected` events fire.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  Wallet,
} from 'lucide-react'
import { formatINR, formatRelative } from '@/lib/format'
import { useSocketEvent } from '@/hooks/use-socket'

interface Summary {
  outstanding: number
  pendingCount: number
  oldestPendingDate: string | null
  isOverdue: boolean
  isBlocked: boolean
  restaurant: {
    platformFeeBlocked: boolean
    platformFeeBlockReason: string | null
  }
}

async function fetchSummary(): Promise<Summary> {
  const res = await fetch('/api/admin/platform-fees', { cache: 'no-store' })
  if (!res.ok) return null as any
  const json = await res.json()
  return json.data
}

export function PlatformFeeAlertBanner() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin-platform-fees', 'summary'],
    queryFn: fetchSummary,
    refetchInterval: 60_000,
    retry: false,
  })

  // Realtime: refresh when fees are paid or collected
  useSocketEvent('platform:feePaid', () => {
    qc.invalidateQueries({ queryKey: ['admin-platform-fees', 'summary'] })
  })
  useSocketEvent('platform:feeCollected', () => {
    qc.invalidateQueries({ queryKey: ['admin-platform-fees', 'summary'] })
  })

  // Don't show if no data, no outstanding, or not overdue/blocked
  if (!data || data.outstanding < 0.01) return null
  if (!data.isOverdue && !data.isBlocked) return null

  const blocked = data.isBlocked
  const overdueDays = data.oldestPendingDate
    ? Math.floor((Date.now() - new Date(data.oldestPendingDate).getTime()) / (24 * 60 * 60 * 1000))
    : 0

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className={`overflow-hidden rounded-xl border ${
          blocked
            ? 'border-red-300 bg-red-50'
            : 'border-amber-300 bg-amber-50'
        }`}
      >
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                blocked
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {blocked ? (
                <Ban className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className={`text-sm font-bold ${
                blocked ? 'text-red-900' : 'text-amber-900'
              }`}>
                {blocked
                  ? 'Your restaurant is blocked'
                  : 'Platform fees overdue'}
              </h3>
              <p className={`text-xs ${
                blocked ? 'text-red-700' : 'text-amber-700'
              }`}>
                {blocked
                  ? data.restaurant.platformFeeBlockReason
                    ? `Reason: ${data.restaurant.platformFeeBlockReason}. `
                    : ''
                  : ''}
                You have <strong>{formatINR(data.outstanding)}</strong> pending across{' '}
                {data.pendingCount} {data.pendingCount === 1 ? 'fee' : 'fees'}
                {data.oldestPendingDate && (
                  <> · oldest from {formatRelative(data.oldestPendingDate)} ({overdueDays}d)</>
                )}
                . Please pay now to avoid service interruption.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              // Navigate to Settings → Platform fees tab
              if (typeof window !== 'undefined') {
                window.location.hash = 'settings'
                // Wait for Settings to mount, then trigger the platform-fees tab.
                // Radix TabsTrigger renders a button with a `value` attribute.
                setTimeout(() => {
                  const tab = document.querySelector('[value="platform-fees"]') as HTMLElement | null
                  if (tab) (tab as HTMLButtonElement).click()
                }, 300)
              }
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              blocked
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            <Wallet className="h-3.5 w-3.5" />
            Pay {formatINR(data.outstanding)} now
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
