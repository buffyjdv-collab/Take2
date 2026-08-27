'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAdminSettings, api } from '@/hooks/api'
import { useQueryClient } from '@tanstack/react-query'
import { LoadingSpinner, ButtonWithLoading, EmptyState } from '@/components/restaurant/loading-states'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { PaymentMethodsManager } from './payment-methods-manager'

export function SettingsManager() {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role
  // Super admin needs to pick a restaurant — for simplicity, we use the first one
  // via passing no restaurantId and letting the API return 400. Better: provide a selector.
  const [superRestaurantId, setSuperRestaurantId] = useState<string>('')
  const effectiveId = role === 'SUPER_ADMIN' ? superRestaurantId : undefined
  const { data, isLoading, error } = useAdminSettings(effectiveId)
  const qc = useQueryClient()

  const [form, setForm] = useState<any>(null)

  useEffect(() => {
    if (data) {
      setForm({
        ...data,
        settings: data.settings || {},
      })
    }
  }, [data])

  if (role === 'SUPER_ADMIN' && !superRestaurantId) {
    return (
      <div className="p-4 lg:p-6">
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-bold">Pick a restaurant</h2>
            <p className="text-sm text-muted-foreground">
              Super admins must choose a restaurant to edit settings for.
            </p>
            <SuperAdminRestaurantPicker onPick={setSuperRestaurantId} />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading) {
    return <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
  }
  if (error) {
    return (
      <div className="p-4">
        <EmptyState title="Couldn't load settings" description={(error as Error).message} />
      </div>
    )
  }
  if (!form) return null

  const set = (patch: Record<string, any>) => setForm({ ...form, ...patch })
  const setSettings = (patch: Record<string, any>) =>
    setForm({ ...form, settings: { ...(form.settings || {}), ...patch } })

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        address: form.address,
        phone: form.phone,
        email: form.email,
        website: form.website,
        logo: form.logo,
        gstNumber: form.gstNumber,
        panNumber: form.panNumber,
        taxRate: form.taxRate,
        serviceChargeRate: form.serviceChargeRate,
        openingTime: form.openingTime,
        closingTime: form.closingTime,
        isOpen: form.isOpen,
        acceptUpi: form.acceptUpi,
        acceptCard: form.acceptCard,
        acceptCash: form.acceptCash,
        acceptCounter: form.acceptCounter,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        upiId: form.upiId,
        settings: form.settings,
      }
      await api(`/api/admin/settings${effectiveId ? `?restaurantId=${effectiveId}` : ''}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      toast.success('Settings saved')
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">{form.name}</p>
        </div>
        <ButtonWithLoading
          onClick={handleSave}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          Save changes
        </ButtonWithLoading>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tax">Tax & billing</TabsTrigger>
          <TabsTrigger value="hours">Hours</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="receipt">Receipt</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader><CardTitle className="text-base">Restaurant profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={form.name || ''} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Tagline"><Input value={form.tagline || ''} onChange={(e) => set({ tagline: e.target.value })} /></Field>
              <Field label="Address" full><Input value={form.address || ''} onChange={(e) => set({ address: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="Email"><Input value={form.email || ''} onChange={(e) => set({ email: e.target.value })} /></Field>
              <Field label="Website"><Input value={form.website || ''} onChange={(e) => set({ website: e.target.value })} /></Field>
              <Field label="Logo URL"><Input value={form.logo || ''} onChange={(e) => set({ logo: e.target.value })} /></Field>
              <Field label="Description" full>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  rows={3}
                  value={form.description || ''}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax">
          <Card>
            <CardHeader><CardTitle className="text-base">Tax & billing</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="GST number"><Input value={form.gstNumber || ''} onChange={(e) => set({ gstNumber: e.target.value })} /></Field>
              <Field label="PAN number"><Input value={form.panNumber || ''} onChange={(e) => set({ panNumber: e.target.value })} /></Field>
              <Field label="Tax rate (0–1, e.g. 0.05 = 5%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.taxRate}
                  onChange={(e) => set({ taxRate: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Service charge rate (0–1)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.serviceChargeRate}
                  onChange={(e) => set({ serviceChargeRate: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours">
          <Card>
            <CardHeader><CardTitle className="text-base">Opening hours</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Opening time"><Input type="time" value={form.openingTime || '09:00'} onChange={(e) => set({ openingTime: e.target.value })} /></Field>
              <Field label="Closing time"><Input type="time" value={form.closingTime || '23:00'} onChange={(e) => set({ closingTime: e.target.value })} /></Field>
              <Field label="Currently open">
                <label className="flex items-center gap-2">
                  <Switch checked={form.isOpen} onCheckedChange={(v) => set({ isOpen: v })} />
                  <span className="text-sm">{form.isOpen ? 'Open for orders' : 'Closed'}</span>
                </label>
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          {/* NEW: Zepto-style Payment Methods Manager */}
          <PaymentMethodsManager restaurantId={effectiveId || undefined} />

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Payment collection timing</CardTitle>
              <p className="text-xs text-muted-foreground">
                Choose when the customer must pay for their order. This affects
                the entire order flow — see the helper text under each option.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ToggleRow
                label="Allow pre-payment requests"
                checked={form.settings?.allowPrePayment ?? true}
                onChange={(v) => setSettings({ allowPrePayment: v })}
              />
              <p className="-mt-2 ml-1 text-xs text-muted-foreground">
                Lets you (or the cashier) ask the customer to pay BEFORE the
                order is accepted. Disable to forbid pre-payment entirely.
              </p>

              <ToggleRow
                label="Require pre-payment for every new order"
                checked={form.settings?.requirePrePayment ?? false}
                onChange={(v) => setSettings({ requirePrePayment: v })}
                disabled={!form.settings?.allowPrePayment}
              />
              <p className="-mt-2 ml-1 text-xs text-muted-foreground">
                When ON, every new order is created with status
                <code className="mx-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">PENDING_PAYMENT</code>
                and is hidden from the kitchen/orders module until the customer
                pays. Once paid, the order automatically moves to NEW and
                becomes visible for acceptance.
              </p>

              <div className="my-2 border-t border-slate-100" />

              <ToggleRow
                label="Allow post-payment requests"
                checked={form.settings?.allowPostPayment ?? true}
                onChange={(v) => setSettings({ allowPostPayment: v })}
              />
              <p className="-mt-2 ml-1 text-xs text-muted-foreground">
                Lets you (or the waiter) ask the customer to pay AFTER the order
                is served. Disable to forbid post-payment entirely.
              </p>

              <ToggleRow
                label="Require post-payment for every served order"
                checked={form.settings?.requirePostPayment ?? false}
                onChange={(v) => setSettings({ requirePostPayment: v })}
                disabled={!form.settings?.allowPostPayment}
              />
              <p className="-mt-2 ml-1 text-xs text-muted-foreground">
                When ON, every order that reaches SERVED status automatically
                gets a post-payment request — the customer is prompted to pay
                before leaving the table.
              </p>

              <div className="my-2 border-t border-slate-100" />

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <strong>Cash payments:</strong> Waiters, owners, managers, and
                cashiers can mark any unpaid order as &ldquo;Paid in cash&rdquo;
                (or &ldquo;Paid at counter&rdquo;) from the orders module. The
                acting user&apos;s name is recorded on the order and appears in
                the payments report.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="theme">
          <Card>
            <CardHeader><CardTitle className="text-base">Theme</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Primary color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor || '#EA580C'}
                    onChange={(e) => set({ primaryColor: e.target.value })}
                    className="h-9 w-12 rounded border"
                  />
                  <Input value={form.primaryColor || ''} onChange={(e) => set({ primaryColor: e.target.value })} />
                </div>
              </Field>
              <Field label="Accent color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.accentColor || '#16A34A'}
                    onChange={(e) => set({ accentColor: e.target.value })}
                    className="h-9 w-12 rounded border"
                  />
                  <Input value={form.accentColor || ''} onChange={(e) => set({ accentColor: e.target.value })} />
                </div>
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipt">
          <Card>
            <CardHeader><CardTitle className="text-base">Receipt</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <Field label="Receipt header">
                <Input value={form.settings?.receiptHeader || ''} onChange={(e) => setSettings({ receiptHeader: e.target.value })} />
              </Field>
              <Field label="Receipt footer">
                <Input value={form.settings?.receiptFooter || ''} onChange={(e) => setSettings({ receiptFooter: e.target.value })} />
              </Field>
              <ToggleRow
                label="Show logo on receipt"
                checked={form.settings?.showLogoOnReceipt ?? true}
                onChange={(v) => setSettings({ showLogoOnReceipt: v })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader><CardTitle className="text-base">Notifications & automation</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow label="Notify kitchen on new order" checked={form.settings?.notifyKitchenOnNewOrder ?? true} onChange={(v) => setSettings({ notifyKitchenOnNewOrder: v })} />
              <ToggleRow label="Notify waiter on bill request" checked={form.settings?.notifyWaiterOnBillRequest ?? true} onChange={(v) => setSettings({ notifyWaiterOnBillRequest: v })} />
              <ToggleRow label="Play sound on new order" checked={form.settings?.playSoundOnNewOrder ?? true} onChange={(v) => setSettings({ playSoundOnNewOrder: v })} />
              <ToggleRow label="Auto-accept new orders" checked={form.settings?.autoAcceptOrders ?? false} onChange={(v) => setSettings({ autoAcceptOrders: v })} />
              <ToggleRow label="Allow customer to call waiter" checked={form.settings?.allowCallWaiter ?? true} onChange={(v) => setSettings({ allowCallWaiter: v })} />
              <ToggleRow label="Allow customer to request bill" checked={form.settings?.allowRequestBill ?? true} onChange={(v) => setSettings({ allowRequestBill: v })} />
              <ToggleRow label="Tax inclusive pricing" checked={form.settings?.taxInclusive ?? false} onChange={(v) => setSettings({ taxInclusive: v })} />
              <Field label="Max items per order">
                <Input
                  type="number"
                  value={form.settings?.maxItemsPerOrder ?? 50}
                  onChange={(e) => setSettings({ maxItemsPerOrder: parseInt(e.target.value) || 50 })}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <Label className="mb-1 block text-xs">{label}</Label>
      {children}
    </div>
  )
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function SuperAdminRestaurantPicker({ onPick }: { onPick: (id: string) => void }) {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/admin/staff')
      .then((r) => r.json())
      .then(() => {
        // Use tables endpoint scoped to all restaurants — but super-admin needs a list.
        // Simpler: hit /api/admin/tables with no restaurantId (returns all tables cross-restaurants).
        return fetch('/api/admin/tables').then((r) => r.json())
      })
      .then((d) => {
        // Group by restaurantId
        const map = new Map<string, string>()
        for (const t of d?.data || []) {
          if (t.restaurantId && !map.has(t.restaurantId)) {
            map.set(t.restaurantId, `Restaurant ${t.restaurantId.slice(-4)}`)
          }
        }
        setList(Array.from(map.entries()).map(([id, name]) => ({ id, name })))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {list.map((r) => (
        <Button key={r.id} variant="outline" onClick={() => onPick(r.id)}>
          {r.name}
        </Button>
      ))}
    </div>
  )
}
