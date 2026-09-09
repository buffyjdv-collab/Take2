'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  useAdminBranches,
  api,
  type AdminBranch,
  type BranchStats,
} from '@/hooks/api'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Phone,
  Table2,
  UserRoundCog,
  UserX,
  IndianRupee,
  ShoppingBag,
  TrendingUp,
  Store,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner, EmptyState, ButtonWithLoading } from '@/components/restaurant/loading-states'
import { ConfirmDialog } from '@/components/restaurant/confirm-dialog'
import { formatINR } from '@/components/restaurant/price'

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatBlock({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: any
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-slate-50/60 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-100 text-orange-700">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-base font-bold leading-tight">{value}</p>
        {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  )
}

function TopItems({ items }: { items: BranchStats['topItems'] }) {
  if (!items.length) {
    return <p className="text-xs text-muted-foreground">No product sales in the last 7 days.</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 3).map((it) => (
        <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-slate-700">{it.name}</span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
            {it.quantity} sold
          </span>
          <span className="shrink-0 font-semibold text-slate-900">{formatINR(it.revenue)}</span>
        </li>
      ))}
    </ul>
  )
}

function ManagerChips({
  branch,
  onUnassign,
  busyId,
}: {
  branch: AdminBranch
  onUnassign: (u: { id: string; name: string }) => void
  busyId: string | null
}) {
  const staff = branch.users
  if (!staff.length) {
    return <p className="text-xs text-muted-foreground">No staff assigned yet.</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {staff.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1.5 text-xs text-slate-700"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-green-500' : 'bg-slate-400'}`} />
          <span className="max-w-[140px] truncate">{u.name}</span>
          <span className="text-[10px] uppercase text-muted-foreground">
            {u.role.replace('_', ' ')}
          </span>
          <button
            onClick={() => onUnassign(u)}
            disabled={busyId === u.id}
            title="Unassign from this branch"
            aria-label={`Unassign ${u.name} from ${branch.name}`}
            className="ml-0.5 rounded-full p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
          >
            <UserX className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BranchesManager() {
  const { data, isLoading } = useAdminBranches()
  const qc = useQueryClient()

  // Branch create/edit dialog
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{
    id?: string
    name: string
    address: string
    phone: string
    active: boolean
  } | null>(null)

  // Manager create dialog (per branch)
  const [mgrOpen, setMgrOpen] = useState(false)
  const [mgrBranch, setMgrBranch] = useState<AdminBranch | null>(null)
  const [mgrForm, setMgrForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [mgrSaving, setMgrSaving] = useState(false)

  // Delete / unassign confirmations
  const [deleteTarget, setDeleteTarget] = useState<AdminBranch | null>(null)
  const [unassignTarget, setUnassignTarget] = useState<{ branch: AdminBranch; user: { id: string; name: string } } | null>(null)
  const [unassignBusyId, setUnassignBusyId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-branches'] })
    qc.invalidateQueries({ queryKey: ['admin-staff'] })
    qc.invalidateQueries({ queryKey: ['admin-tables'] })
  }

  const handleNew = () => {
    setEditing({ name: '', address: '', phone: '', active: true })
    setOpen(true)
  }

  const handleEdit = (b: AdminBranch) => {
    setEditing({ id: b.id, name: b.name, address: b.address, phone: b.phone || '', active: b.active })
    setOpen(true)
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) {
        await api(`/api/admin/branches/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editing),
        })
        toast.success('Branch updated')
      } else {
        await api(`/api/admin/branches`, {
          method: 'POST',
          body: JSON.stringify(editing),
        })
        toast.success('Branch created')
      }
      invalidate()
      setOpen(false)
      setEditing(null)
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (b: AdminBranch) => {
    setTogglingId(b.id)
    try {
      await api(`/api/admin/branches/${b.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !b.active }),
      })
      toast.success(b.active ? 'Branch disabled' : 'Branch enabled')
      invalidate()
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await api<any>(`/api/admin/branches/${deleteTarget.id}`, { method: 'DELETE' })
      toast.success(
        res?.detachedStaff > 0
          ? `Branch deleted — ${res.detachedStaff} staff member(s) detached`
          : 'Branch deleted',
      )
      invalidate()
      setDeleteTarget(null)
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleAddManager = (b: AdminBranch) => {
    setMgrBranch(b)
    setMgrForm({ name: '', email: '', phone: '', password: '' })
    setMgrOpen(true)
  }

  const handleSaveManager = async () => {
    if (!mgrBranch) return
    setMgrSaving(true)
    try {
      await api(`/api/admin/staff`, {
        method: 'POST',
        body: JSON.stringify({
          name: mgrForm.name,
          email: mgrForm.email,
          phone: mgrForm.phone || undefined,
          password: mgrForm.password,
          role: 'MANAGER',
          branchId: mgrBranch.id,
        }),
      })
      toast.success(`Manager added to ${mgrBranch.name}`)
      invalidate()
      setMgrOpen(false)
      setMgrBranch(null)
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setMgrSaving(false)
    }
  }

  const handleUnassign = async () => {
    if (!unassignTarget) return
    setUnassignBusyId(unassignTarget.user.id)
    try {
      await api(`/api/admin/staff/${unassignTarget.user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ branchId: null }),
      })
      toast.success(`${unassignTarget.user.name} unassigned from ${unassignTarget.branch.name}`)
      invalidate()
      setUnassignTarget(null)
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setUnassignBusyId(null)
    }
  }

  const branches = data?.branches || []
  const totals = data?.totals
  const unassigned = data?.unassigned

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Branches</h1>
          <p className="text-sm text-muted-foreground">
            {branches.length} location{branches.length === 1 ? '' : 's'} · sales, products &amp; teams across all of them
          </p>
        </div>
        <Button onClick={handleNew} className="bg-orange-600 text-white hover:bg-orange-700">
          <Plus className="mr-2 h-4 w-4" /> Add branch
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
      ) : !branches.length ? (
        <EmptyState
          title="No branches yet"
          description="Add your first branch, assign a manager, and attach tables to it — each location gets its own sales, product and revenue tracking."
        />
      ) : (
        <>
          {/* Network totals */}
          {totals && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatBlock
                label="Today revenue"
                value={formatINR(totals.todayRevenue)}
                sub={`${totals.todayOrders} order${totals.todayOrders === 1 ? '' : 's'} · all branches`}
                icon={IndianRupee}
              />
              <StatBlock
                label="7-day revenue"
                value={formatINR(totals.weekRevenue)}
                sub={`${totals.weekOrders} order${totals.weekOrders === 1 ? '' : 's'} · all branches`}
                icon={TrendingUp}
              />
              <StatBlock
                label="Locations"
                value={String(branches.length)}
                sub={`${branches.filter((b) => b.active).length} active`}
                icon={Store}
              />
              <StatBlock
                label="Team"
                value={String(branches.reduce((s, b) => s + b.users.length, 0))}
                sub="staff assigned to branches"
                icon={Users}
              />
            </div>
          )}

          {/* Unattributed orders hint */}
          {unassigned && unassigned.weekOrders > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">{unassigned.weekOrders} order{unassigned.weekOrders === 1 ? '' : 's'}</span>{' '}
              ({formatINR(unassigned.weekRevenue)}) in the last 7 days are not attributed to any branch —
              assign their tables to a branch in <span className="font-semibold">Tables &amp; QR</span> so
              they count towards that location.
            </div>
          )}

          {/* Branch cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {branches.map((b) => (
              <Card key={b.id} className={b.active ? '' : 'opacity-70'}>
                <CardContent className="space-y-4 p-4">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-bold">{b.name}</h2>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            b.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {b.active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{b.address}</span>
                      </p>
                      {b.phone && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" /> {b.phone}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(b)}
                        aria-label={`Edit ${b.name}`}
                        className="h-8 w-8"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(b)}
                        aria-label={`Delete ${b.name}`}
                        className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Sales stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <StatBlock
                      label="Today"
                      value={formatINR(b.stats.todayRevenue)}
                      sub={`${b.stats.todayOrders} order${b.stats.todayOrders === 1 ? '' : 's'}`}
                      icon={IndianRupee}
                    />
                    <StatBlock
                      label="Last 7 days"
                      value={formatINR(b.stats.weekRevenue)}
                      sub={`${b.stats.weekOrders} order${b.stats.weekOrders === 1 ? '' : 's'}`}
                      icon={TrendingUp}
                    />
                  </div>

                  {/* Products monitoring */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <ShoppingBag className="h-3.5 w-3.5" /> Top products (7 days)
                    </p>
                    <TopItems items={b.stats.topItems} />
                  </div>

                  {/* Tables + team */}
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Table2 className="h-3.5 w-3.5" /> Tables
                      </p>
                      <p className="text-sm text-slate-700">
                        {b.tableCount} table{b.tableCount === 1 ? '' : 's'} assigned
                      </p>
                    </div>
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <UserRoundCog className="h-3.5 w-3.5" /> Branch team
                      </p>
                      <ManagerChips
                        branch={b}
                        busyId={unassignBusyId}
                        onUnassign={(u) => setUnassignTarget({ branch: b, user: u })}
                      />
                    </div>
                  </div>

                  {/* Footer actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddManager(b)}
                      className="border-orange-200 text-orange-700 hover:bg-orange-50"
                    >
                      <UserRoundCog className="mr-1.5 h-4 w-4" /> Add manager
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{b.active ? 'Enabled' : 'Disabled'}</span>
                      <Switch
                        checked={b.active}
                        disabled={togglingId === b.id}
                        onCheckedChange={() => handleToggleActive(b)}
                        aria-label={`Toggle ${b.name}`}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Create / edit branch dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit branch' : 'Add branch'}</DialogTitle>
            <DialogDescription>
              A branch is a physical location. Assign tables and a manager to it — its orders, sales
              and products are then tracked separately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="branch-name">Branch name</Label>
              <Input
                id="branch-name"
                placeholder="e.g. Downtown"
                value={editing?.name || ''}
                onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-address">Address</Label>
              <Input
                id="branch-address"
                placeholder="Street, area, city"
                value={editing?.address || ''}
                onChange={(e) => setEditing((s) => (s ? { ...s, address: e.target.value } : s))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch-phone">Phone (optional)</Label>
              <Input
                id="branch-phone"
                placeholder="+91 …"
                value={editing?.phone || ''}
                onChange={(e) => setEditing((s) => (s ? { ...s, phone: e.target.value } : s))}
              />
            </div>
            {editing?.id && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Branch enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Disabled branches keep their data but can be paused.
                  </p>
                </div>
                <Switch
                  checked={editing.active}
                  onCheckedChange={(v) => setEditing((s) => (s ? { ...s, active: v } : s))}
                  aria-label="Toggle branch enabled"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <ButtonWithLoading
              onClick={handleSave}
              loading={saving}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {editing?.id ? 'Save changes' : 'Create branch'}
            </ButtonWithLoading>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add manager dialog */}
      <Dialog open={mgrOpen} onOpenChange={setMgrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add manager — {mgrBranch?.name}</DialogTitle>
            <DialogDescription>
              The manager signs in with these credentials and sees only this branch&apos;s orders,
              tables, kitchen and reports.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mgr-name">Full name</Label>
              <Input
                id="mgr-name"
                placeholder="e.g. Priya Sharma"
                value={mgrForm.name}
                onChange={(e) => setMgrForm((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mgr-email">Email (sign-in)</Label>
              <Input
                id="mgr-email"
                type="email"
                placeholder="manager@yourrestaurant.com"
                value={mgrForm.email}
                onChange={(e) => setMgrForm((s) => ({ ...s, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mgr-phone">Phone (optional)</Label>
              <Input
                id="mgr-phone"
                value={mgrForm.phone}
                onChange={(e) => setMgrForm((s) => ({ ...s, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mgr-password">Temporary password</Label>
              <Input
                id="mgr-password"
                type="password"
                placeholder="At least 6 characters"
                value={mgrForm.password}
                onChange={(e) => setMgrForm((s) => ({ ...s, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMgrOpen(false)}>Cancel</Button>
            <ButtonWithLoading
              onClick={handleSaveManager}
              loading={mgrSaving}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              Create manager
            </ButtonWithLoading>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete branch confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="Staff assigned to this branch will be detached (not deleted); its tables become unassigned. Orders keep their history. This cannot be undone."
        confirmLabel="Delete branch"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* Unassign staff confirm */}
      <ConfirmDialog
        open={!!unassignTarget}
        onOpenChange={(o) => !o && setUnassignTarget(null)}
        title={`Unassign ${unassignTarget?.user.name}?`}
        description={`They will no longer be scoped to ${unassignTarget?.branch.name} and will see the whole restaurant again. Their account stays active.`}
        confirmLabel="Unassign"
        onConfirm={handleUnassign}
      />
    </div>
  )
}
