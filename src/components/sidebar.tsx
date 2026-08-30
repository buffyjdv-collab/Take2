'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ShoppingBag,
  UtensilsCrossed,
  Table2,
  ChefHat,
  BellRing,
  Receipt,
  BarChart3,
  Users,
  Settings,
  QrCode,
  LogOut,
  Building2,
  Globe2,
  CreditCard,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from 'next-auth/react'
import { hasModuleAccess, ROLE_LABELS } from '@/lib/auth'
import type { Role } from '@/lib/types'
import { api } from '@/hooks/api'

interface NavItem {
  key: string
  label: string
  icon: any
  permission?: string
  roles?: Role[]
  /** 'platform' group is super-admin-only and shown above restaurant nav. */
  group?: 'platform' | 'restaurant'
}

export type { NavItem }

/**
 * NAV
 * Single source of truth for the admin/platform navigation. Reused by:
 *  - <Sidebar>            (desktop sidebar + mobile drawer)
 *  - <AdminBottomNav>     (mobile-only bottom tab bar)
 *
 * Order matters: the items appear here in the order they should be displayed.
 */
export const NAV: NavItem[] = [
  // Platform-level (super admin only)
  { key: 'platform-dashboard', label: 'Platform Overview', icon: Globe2, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-restaurants', label: 'Tenants', icon: Building2, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-users', label: 'All Users', icon: Users, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-fees', label: 'Platform Fees', icon: CreditCard, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-fee-config', label: 'Fee Configuration', icon: CreditCard, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-plans', label: 'Plans & Billing', icon: CreditCard, group: 'platform', permission: 'restaurants.manage' },
  { key: 'platform-rbac', label: 'RBAC & Modules', icon: Shield, group: 'platform', permission: 'restaurants.manage' },

  // Restaurant-level
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view', group: 'restaurant' },
  { key: 'orders', label: 'Orders', icon: ShoppingBag, permission: 'orders.view', group: 'restaurant' },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, permission: 'menu.update', group: 'restaurant' },
  { key: 'modifiers', label: 'Modifiers', icon: UtensilsCrossed, permission: 'menu.update', group: 'restaurant' },
  { key: 'tables', label: 'Tables & QR', icon: Table2, permission: 'tables.manage', group: 'restaurant' },
  { key: 'kitchen', label: 'Kitchen', icon: ChefHat, permission: 'kitchen.view', group: 'restaurant' },
  { key: 'waiter', label: 'Waiter', icon: BellRing, permission: 'waiter.view', group: 'restaurant' },
  { key: 'billing', label: 'Billing', icon: Receipt, permission: 'billing.manage', group: 'restaurant' },
  { key: 'reports', label: 'Reports', icon: BarChart3, permission: 'reports.view', group: 'restaurant' },
  { key: 'staff', label: 'Staff', icon: Users, permission: 'staff.manage', group: 'restaurant' },
  { key: 'settings', label: 'Settings', icon: Settings, permission: 'settings.manage', group: 'restaurant' },
]

export function Sidebar({
  role,
  activeKey,
  restaurantName,
  userName,
  onNavigate,
}: {
  role: string
  activeKey: string
  restaurantName?: string | null
  userName?: string | null
  onNavigate?: (key: string) => void
}) {
  // The server-side render uses the static fallback (hasModuleAccess) for the
  // first paint. On mount, we fetch the DB-backed module list so any changes
  // made by the super admin in the RBAC manager take effect for the current
  // user immediately (within 30s, the cache TTL on the server).
  const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!role || role === 'SUPER_ADMIN') return // super admin sees everything
    let cancelled = false
    api<{ modules: string[] }>('/api/platform/rbac/me')
      .then((res) => {
        if (!cancelled) setVisibleKeys(new Set(res.modules))
      })
      .catch(() => {
        // Ignore — fall back to static hasModuleAccess
      })
    return () => {
      cancelled = true
    }
  }, [role])

  const visible = role
    ? NAV.filter((n) => {
        // SUPER_ADMIN sees everything
        if (role === 'SUPER_ADMIN') return true
        // DB-backed visibility (once loaded)
        if (visibleKeys) return visibleKeys.has(n.key)
        // Static fallback before the fetch resolves
        return hasModuleAccess(role, n.key)
      })
    : []
  const platformItems = visible.filter((n) => n.group === 'platform')
  const restaurantItems = visible.filter((n) => n.group === 'restaurant')
  const isPlatformView = activeKey.startsWith('platform-')

  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
          <QrCode className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">
            {role === 'SUPER_ADMIN' && isPlatformView
              ? 'QR Dine Platform'
              : restaurantName || 'QR Dine'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {role === 'SUPER_ADMIN' && isPlatformView
              ? 'Super Admin Console'
              : 'Restaurant OS'}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {/* Platform section */}
        {platformItems.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Platform
            </p>
            {platformItems.map((item) => (
              <NavButton key={item.key} item={item} activeKey={activeKey} onNavigate={onNavigate} />
            ))}
            <div className="my-2 border-t border-slate-100" />
            <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {role === 'SUPER_ADMIN' ? 'Tenant view' : 'Restaurant'}
            </p>
          </>
        )}

        {/* Restaurant section */}
        {restaurantItems.map((item) => (
          <NavButton key={item.key} item={item} activeKey={activeKey} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-slate-200 p-2">
        <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-900">{userName || 'Signed in'}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {role ? (ROLE_LABELS[role] || role.replace(/_/g, ' ')) : 'Loading…'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:bg-red-50 hover:text-red-600"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}

function NavButton({
  item,
  activeKey,
  onNavigate,
}: {
  item: NavItem
  activeKey: string
  onNavigate?: (key: string) => void
}) {
  const Icon = item.icon
  const active = activeKey === item.key
  return (
    <button
      onClick={() => onNavigate?.(item.key)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? item.group === 'platform'
            ? 'bg-slate-900 text-white'
            : 'bg-orange-50 text-orange-700'
          : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4',
          active
            ? item.group === 'platform'
              ? 'text-white'
              : 'text-orange-600'
            : 'text-slate-500',
        )}
      />
      <span className="flex-1 text-left">{item.label}</span>
    </button>
  )
}
