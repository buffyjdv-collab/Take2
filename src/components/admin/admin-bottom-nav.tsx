'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Grid2x2, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { NAV, type NavItem } from '@/components/sidebar'
import { hasModuleAccess } from '@/lib/auth'
import type { Role } from '@/lib/types'
import { api } from '@/hooks/api'

/**
 * AdminBottomNav
 * Mobile-only bottom tab bar for the admin / platform back-office.
 *
 * Pattern: 4 primary tabs + a "More" tab that opens a Sheet containing the
 * full list of nav items the current role can see (mirrors the desktop
 * Sidebar exactly). Tapping any item — primary or in the More sheet —
 * triggers `onNavigate(key)`, which the AppShell already wires into the
 * hash router.
 *
 * Primary tabs are chosen per role so the most-used screen for each role
 * is always one tap away:
 *
 *   SUPER_ADMIN    →  Overview · Tenants · Users   · More
 *   KITCHEN_STAFF  →  Kitchen · Orders  · Dashboard · More
 *   WAITER         →  Waiter  · Orders  · Dashboard · More
 *   CASHIER        →  Billing · Orders  · Dashboard · More
 *   (default)      →  Dashboard · Orders · Menu     · More
 *
 * Hidden on `md:` and up (desktop uses the full sidebar).
 *
 * Visual design:
 *  - 60px tall + safe-area inset
 *  - Frosted white background
 *  - Active tab: orange-600 icon + label, 3px pill indicator above
 *  - "More" tab: opens Sheet from the bottom
 *  - The "More" badge shows a dot when the current view is one of the
 *    items only accessible via More (i.e. not in the primary tab set)
 */

interface AdminBottomNavProps {
  role: string
  activeKey: string
  restaurantName?: string | null
  onNavigate: (key: string) => void
}

/** Per-role primary tab keys. The 4th tab is always "More". */
const PRIMARY_BY_ROLE: Record<string, string[]> = {
  SUPER_ADMIN: ['platform-dashboard', 'platform-restaurants', 'platform-users'],
  KITCHEN_STAFF: ['kitchen', 'orders', 'dashboard'],
  WAITER: ['waiter', 'orders', 'dashboard'],
  CASHIER: ['billing', 'orders', 'dashboard'],
}

const DEFAULT_PRIMARY = ['dashboard', 'orders', 'menu']

function getPrimaryKeys(role: string): string[] {
  return PRIMARY_BY_ROLE[role] || DEFAULT_PRIMARY
}

export function AdminBottomNav({
  role,
  activeKey,
  restaurantName,
  onNavigate,
}: AdminBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  // Mirror the Sidebar's RBAC fetch: super admin sees everything; other
  // roles fetch their DB-backed module list from /api/platform/rbac/me and
  // fall back to the static hasModuleAccess() check while loading.
  const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!role || role === 'SUPER_ADMIN') return
    let cancelled = false
    api<{ modules: string[] }>('/api/platform/rbac/me')
      .then((res) => {
        if (!cancelled) setVisibleKeys(new Set(res.modules))
      })
      .catch(() => {
        // Fall back to static hasModuleAccess below.
      })
    return () => {
      cancelled = true
    }
  }, [role])

  const visibleItems = useMemo<NavItem[]>(() => {
    if (!role) return []
    return NAV.filter((n) => {
      if (role === 'SUPER_ADMIN') return true
      if (visibleKeys) return visibleKeys.has(n.key)
      return hasModuleAccess(role as Role, n.key)
    })
  }, [role, visibleKeys])

  const primaryKeys = getPrimaryKeys(role)

  // Build primary tabs: only include items the role can actually see.
  const primaryItems = primaryKeys
    .map((k) => visibleItems.find((n) => n.key === k))
    .filter((n): n is NavItem => Boolean(n))

  // "More" items: everything in visibleItems that isn't in primaryItems.
  const moreItems = visibleItems.filter(
    (n) => !primaryKeys.includes(n.key),
  )

  // "More" tab is "active" when the current view is one of its items.
  const moreActive = moreItems.some((n) => n.key === activeKey)

  const handleNavigate = (key: string) => {
    onNavigate(key)
    setMoreOpen(false)
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Admin navigation"
      >
        <div className="mx-auto flex h-[60px] max-w-md items-stretch">
          {primaryItems.map((item) => (
            <BottomTab
              key={item.key}
              item={item}
              active={activeKey === item.key}
              onClick={() => handleNavigate(item.key)}
            />
          ))}

          {/* More tab */}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-current={moreActive ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors',
              moreActive
                ? 'text-orange-600'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {moreActive && (
              <motion.span
                layoutId="admin-bottom-nav-active"
                className="absolute top-0 h-[3px] w-10 rounded-b-full bg-orange-600"
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            )}
            <MoreHorizontal
              className="h-[18px] w-[18px]"
              strokeWidth={moreActive ? 2.4 : 2}
            />
            <span
              className={cn(
                'text-[10px] font-semibold leading-none',
                moreActive ? 'text-orange-700' : 'text-slate-500',
              )}
            >
              More
            </span>
            {/* Notification dot when More contains the active view */}
            {moreActive && (
              <span className="absolute right-[28%] top-1.5 h-1.5 w-1.5 rounded-full bg-orange-500" />
            )}
          </button>
        </div>
      </nav>

      {/* "More" sheet — slides up from the bottom on mobile */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-md rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b border-slate-100 px-4 pb-3 pt-4">
            <SheetTitle className="text-left text-base font-bold">
              {restaurantName || 'QR Dine'}
            </SheetTitle>
            <p className="text-left text-[11px] text-slate-500">
              All sections
            </p>
          </SheetHeader>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {moreItems.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-400">
                No more sections available.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-0.5">
                {moreItems.map((item) => {
                  const Icon: LucideIcon = item.icon
                  const active = activeKey === item.key
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => handleNavigate(item.key)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                          active
                            ? item.group === 'platform'
                              ? 'bg-slate-900 text-white'
                              : 'bg-orange-50 text-orange-700'
                            : 'text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px]',
                            active
                              ? item.group === 'platform'
                                ? 'text-white'
                                : 'text-orange-600'
                              : 'text-slate-500',
                          )}
                        />
                        <span className="flex-1 text-left">{item.label}</span>
                        {active && (
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * BottomTab
 * A single primary tab in the bottom bar. Uses framer-motion `layoutId` so
 * the active-indicator pill slides smoothly between tabs.
 */
function BottomTab({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon: LucideIcon = item.icon
  // Shorten labels for the bottom bar: "Platform Overview" → "Overview",
  // "Tables & QR" → "Tables". Falls back to the full label if no short
  // form is configured.
  const shortLabel = SHORT_LABELS[item.key] ?? item.label
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors',
        active
          ? 'text-orange-600'
          : 'text-slate-500 hover:text-slate-800',
      )}
    >
      {active && (
        <motion.span
          layoutId="admin-bottom-nav-active"
          className="absolute top-0 h-[3px] w-10 rounded-b-full bg-orange-600"
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      )}
      <Icon
        className="h-[18px] w-[18px]"
        strokeWidth={active ? 2.4 : 2}
      />
      <span
        className={cn(
          'max-w-full truncate text-[10px] font-semibold leading-none',
          active ? 'text-orange-700' : 'text-slate-500',
        )}
      >
        {shortLabel}
      </span>
    </button>
  )
}

/**
 * SHORT_LABELS
 * Compact labels for the bottom-bar primary tabs. Keys not present here
 * fall back to the full NavItem.label.
 */
const SHORT_LABELS: Record<string, string> = {
  'platform-dashboard': 'Overview',
  'platform-restaurants': 'Tenants',
  'platform-users': 'Users',
  'platform-fees': 'Fees',
  'platform-fee-config': 'Fee Cfg',
  'platform-plans': 'Plans',
  'platform-rbac': 'RBAC',
  dashboard: 'Home',
  orders: 'Orders',
  menu: 'Menu',
  modifiers: 'Mods',
  tables: 'Tables',
  kitchen: 'Kitchen',
  waiter: 'Waiter',
  billing: 'Billing',
  reports: 'Reports',
  staff: 'Staff',
  settings: 'Settings',
}

// Re-export Grid2x2 as a fallback icon (currently unused but kept for
// future "all sections" grid view).
export const _FallbackIcon = Grid2x2
