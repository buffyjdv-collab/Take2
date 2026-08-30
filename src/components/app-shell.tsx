'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Sidebar } from './sidebar'
import { Dashboard } from './admin/dashboard'
import { OrdersManager } from './admin/orders-manager'
import { MenuManager } from './admin/menu-manager'
import { ModifierGroupsManager } from './admin/modifier-groups-manager'
import { TablesManager } from './admin/tables-manager'
import { ReportsManager } from './admin/reports-manager'
import { SettingsManager } from './admin/settings-manager'
import { StaffManager } from './admin/staff-manager'
import { BillingManager } from './admin/billing-manager'
import { KitchenDisplay } from './kitchen/kitchen-display'
import { WaiterDashboard } from './waiter/waiter-dashboard'
import { ServiceRequestsWidget } from './admin/service-requests-widget'
import { PlatformDashboard } from './platform/platform-dashboard'
import { PlatformRestaurantsManager } from './platform/platform-restaurants-manager'
import { PlatformUsersManager } from './platform/platform-users-manager'
import { PlatformFeeConfig } from './platform/platform-fee-config'
import { PlatformFeesCollected } from './platform/platform-fees-collected'
import { PlatformRbacManager } from './platform/platform-rbac-manager'
import { AdminBottomNav } from './admin/admin-bottom-nav'
import { Menu as MenuIcon, BellRing } from 'lucide-react'
import { useSocketEvent } from '@/hooks/use-socket'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface AppShellProps {
  serverSession?: any
}

export function AppShell({ serverSession }: AppShellProps) {
  const { data: clientSession, status } = useSession()

  // Use server session immediately, fall back to client session once loaded
  const session = clientSession ?? serverSession
  const isLoading = status === 'loading' && !serverSession

  const [hash, setHash] = useState<string>('dashboard')
  const qc = useQueryClient()

  // Determine default view based on role
  useEffect(() => {
    const role = (session?.user as any)?.role
    const apply = () => {
      const h = window.location.hash.replace('#', '')
      if (h) {
        setHash(h)
      } else {
        // Default per role
        const def =
          role === 'SUPER_ADMIN'
            ? 'platform-dashboard'
            : role === 'KITCHEN_STAFF'
            ? 'kitchen'
            : role === 'WAITER'
            ? 'waiter'
            : role === 'CASHIER'
            ? 'billing'
            : 'dashboard'
        setHash(def)
        window.location.hash = def
      }
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [session?.user])

  // Real-time event handling
  useSocketEvent('order:new', (payload: any) => {
    qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
    qc.invalidateQueries({ queryKey: ['admin-orders'] })
    if (hash === 'kitchen' || hash === 'orders' || hash === 'dashboard') {
      // Optional sound notification
      playBeep()
      toast.success(`New order ${payload?.orderNumber}`, {
        description: payload?.tableNumber
          ? `Table ${payload.tableNumber}`
          : undefined,
      })
    }
  })
  useSocketEvent('order:updated', () => {
    qc.invalidateQueries({ queryKey: ['admin-orders'] })
    qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
  })
  useSocketEvent('order:statusChanged', () => {
    qc.invalidateQueries({ queryKey: ['admin-orders'] })
    qc.invalidateQueries({ queryKey: ['admin-order'] })
    qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
  })
  useSocketEvent('service:new', (payload: any) => {
    qc.invalidateQueries({ queryKey: ['admin-service-requests'] })
    toast.info(`Service request from Table ${payload?.tableNumber}`, {
      description: payload?.type?.replace('_', ' ').toLowerCase(),
    })
  })
  useSocketEvent('payment:confirmed', () => {
    qc.invalidateQueries({ queryKey: ['admin-orders'] })
    qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
  })

  const role = (session?.user as any)?.role as string
  const restaurantName = (session?.user as any)?.restaurantName as string | undefined
  const userName = session?.user?.name

  // For mobile, sidebar is hidden behind a toggle
  const [mobileOpen, setMobileOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          role={role}
          activeKey={hash}
          restaurantName={restaurantName}
          userName={userName}
          onNavigate={(key) => {
            window.location.hash = key
            setHash(key)
          }}
        />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar
              role={role}
              activeKey={hash}
              restaurantName={restaurantName}
              userName={userName}
              onNavigate={(key) => {
                window.location.hash = key
                setHash(key)
                setMobileOpen(false)
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex items-center justify-between border-b bg-white px-4 py-2 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <p className="text-sm font-bold">{restaurantName || 'QR Dine'}</p>
          <div className="w-9" />
        </header>

        <main className="flex-1 overflow-y-auto pb-[76px] md:pb-0">
          {hash === 'platform-dashboard' && (
            <PlatformDashboard onNavigate={(k) => { window.location.hash = k; setHash(k) }} />
          )}
          {hash === 'platform-restaurants' && <PlatformRestaurantsManager />}
          {hash === 'platform-users' && <PlatformUsersManager />}
          {hash === 'platform-fees' && <PlatformFeesCollected />}
          {hash === 'platform-fee-config' && <PlatformFeeConfig />}
          {hash === 'platform-plans' && <PlatformRestaurantsManager />}
          {hash === 'platform-rbac' && <PlatformRbacManager />}
          {hash === 'dashboard' && <Dashboard />}
          {hash === 'orders' && <OrdersManager />}
          {hash === 'menu' && <MenuManager />}
          {hash === 'modifiers' && <ModifierGroupsManager />}
          {hash === 'tables' && <TablesManager />}
          {hash === 'kitchen' && <KitchenDisplay />}
          {hash === 'waiter' && <WaiterDashboard />}
          {hash === 'billing' && <BillingManager />}
          {hash === 'reports' && <ReportsManager />}
          {hash === 'staff' && <StaffManager />}
          {hash === 'settings' && <SettingsManager />}
        </main>

        {/* Mobile bottom tab bar — hidden on md+ where the full sidebar is shown.
            4 primary role-aware tabs + a "More" sheet containing every other
            section the user can access. */}
        <AdminBottomNav
          role={role}
          activeKey={hash}
          restaurantName={restaurantName}
          onNavigate={(key) => {
            window.location.hash = key
            setHash(key)
          }}
        />
      </div>
    </div>
  )
}

let audioCtx: AudioContext | null = null
function playBeep() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)()
    }
    const ctx = audioCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    setTimeout(() => {
      osc.stop()
    }, 180)
  } catch {
    // ignore
  }
}
