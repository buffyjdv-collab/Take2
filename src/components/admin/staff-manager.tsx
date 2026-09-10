'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useAdminStaff, useAdminBranches, api } from '@/hooks/api'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import {
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Search,
  Users,
  UserCheck,
  UserX,
  KeyRound,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner, EmptyState, ButtonWithLoading } from '@/components/restaurant/loading-states'
import { ConfirmDialog } from '@/components/restaurant/confirm-dialog'
import { ROLE_LABELS, PERMISSIONS } from '@/lib/auth'
import { ALL_ROLES, NON_SUPER_ROLES } from '@/lib/validations'
import { hasPermission, canAccessRole } from '@/lib/auth'
import { formatRelative } from '@/lib/format'
import { ApprovalBadge, ManagerApprovalHint } from './approval-badge'

const ROLE_TINT: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  RESTAURANT_OWNER: 'bg-orange-100 text-orange-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  KITCHEN_STAFF: 'bg-amber-100 text-amber-700',
  WAITER: 'bg-green-100 text-green-700',
  CASHIER: 'bg-slate-100 text-slate-700',
}

/** Roles that the current user is allowed to assign.
 *  Branch managers can hire junior staff but never appoint MANAGERs —
 *  that stays an owner-only decision (also enforced server-side). */
function getAssignableRoles(myRole: string): readonly string[] {
  if (myRole === 'SUPER_ADMIN') return ALL_ROLES
  const roles = NON_SUPER_ROLES.filter((r) => canAccessRole(myRole, r))
  if (myRole === 'MANAGER') return roles.filter((r) => r !== 'MANAGER')
  return roles
}

export function StaffManager() {
  const { data, isLoading } = useAdminStaff()
  const { data: session } = useSession()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)
  const [open, setOpen] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [activeFilter, setActiveFilter] = useState<string>('ALL')

  // Reset-password dialog
  const [resetTarget, setResetTarget] = useState<any | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPassword, setResetPassword] = useState('')

  const myRole = ((session?.user as any)?.role as string) || ''
  const isSuperAdmin = myRole === 'SUPER_ADMIN'
  const isManager = myRole === 'MANAGER'
  const assignableRoles = getAssignableRoles(myRole)
  const { data: branchData } = useAdminBranches()
  const branches = branchData?.branches || []

  // ----- Derived data -----
  const stats = useMemo(() => {
    const list = data || []
    const byRole: Record<string, number> = {}
    let active = 0
    let inactive = 0
    for (const u of list) {
      byRole[u.role] = (byRole[u.role] || 0) + 1
      if (u.active) active += 1
      else inactive += 1
    }
    return { total: list.length, active, inactive, byRole }
  }, [data])

  const filtered = useMemo(() => {
    const list = data || []
    const q = search.trim().toLowerCase()
    return list.filter((u: any) => {
      if (q) {
        const haystack = `${u.name || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false
      if (activeFilter === 'ACTIVE' && !u.active) return false
      if (activeFilter === 'INACTIVE' && u.active) return false
      return true
    })
  }, [data, search, roleFilter, activeFilter])

  const hasFilters = search.trim() !== '' || roleFilter !== 'ALL' || activeFilter !== 'ALL'

  // ----- Handlers -----
  const handleNew = () => {
    setEditing({
      name: '',
      email: '',
      password: '',
      role: assignableRoles[0] || 'WAITER',
      phone: '',
      active: true,
      branchId: '',
    })
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      if (editing.id) {
        const patch: any = {
          name: editing.name,
          role: editing.role,
          active: editing.active,
          phone: editing.phone,
          ...(isManager ? {} : { branchId: editing.branchId || null }),
        }
        if (editing.password) patch.password = editing.password
        await api(`/api/admin/staff/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
      } else {
        await api(`/api/admin/staff`, {
          method: 'POST',
          body: JSON.stringify(editing),
        })
      }
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      setOpen(false)
      setEditing(null)
      toast.success(
        editing.id
          ? isManager
            ? 'Staff updated — resubmitted for owner approval'
            : 'Staff updated'
          : isManager
          ? 'Staff submitted — awaiting owner approval'
          : 'Staff created',
      )
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    }
  }

  const handleToggleActive = async (u: any) => {
    try {
      await api(`/api/admin/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !u.active }),
      })
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      toast.success(u.active ? 'Deactivated' : 'Activated')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleDelete = async (u: any) => {
    try {
      await api(`/api/admin/staff/${u.id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      toast.success('Staff deactivated')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const openResetDialog = (u: any) => {
    setResetTarget(u)
    setResetPassword('')
    setResetOpen(true)
  }

  const handleSaveReset = async () => {
    if (!resetTarget) return
    if (resetPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    try {
      await api(`/api/admin/staff/${resetTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: resetPassword }),
      })
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      toast.success(`Password reset for ${resetTarget.name}`)
      setResetOpen(false)
      setResetTarget(null)
      setResetPassword('')
    } catch (err: any) {
      toast.error(err.message || 'Reset failed')
    }
  }

  const clearFilters = () => {
    setSearch('')
    setRoleFilter('ALL')
    setActiveFilter('ALL')
  }

  // Roles to show in the filter dropdown — all roles so super admins can
  // filter to SUPER_ADMIN too.
  const roleFilterOptions = ALL_ROLES

  // Top role breakdown entries (sorted by count desc) for the stat card.
  const roleBreakdown = Object.entries(stats.byRole)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            {stats.total} team member{stats.total === 1 ? '' : 's'}
            {hasFilters && ` · ${filtered.length} matching`}
          </p>
        </div>
        <Button onClick={handleNew} className="bg-orange-600 text-white hover:bg-orange-700">
          <Plus className="mr-2 h-4 w-4" /> Add staff
        </Button>
      </div>

      {isManager && (
        <ManagerApprovalHint what="Staff accounts" />
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-slate-200">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Staff</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-full bg-slate-100 p-2">
              <Users className="h-4 w-4 text-slate-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-green-600">{stats.active}</p>
            </div>
            <div className="rounded-full bg-green-100 p-2">
              <UserCheck className="h-4 w-4 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Inactive</p>
              <p className="text-2xl font-bold text-red-600">{stats.inactive}</p>
            </div>
            <div className="rounded-full bg-red-100 p-2">
              <UserX className="h-4 w-4 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">By Role</p>
            {roleBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {roleBreakdown.map(([role, count]) => (
                  <Badge
                    key={role}
                    variant="outline"
                    className={`text-[10px] ${ROLE_TINT[role] || ''}`}
                  >
                    {ROLE_LABELS[role] || role}: {count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone…"
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {roleFilterOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r] || r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
      ) : !data?.length ? (
        <EmptyState title="No staff" description="Add your first team member." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description="Try adjusting your search or filters."
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3">Added</th>
                  <th className="p-3">Active</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u: any) => {
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="p-3 font-medium">
                        {u.name}
                        {!u.active && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            inactive
                          </span>
                        )}
                        <div className="mt-0.5">
                          <ApprovalBadge status={u.approvalStatus} reviewNote={u.reviewNote} />
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{u.email}</td>
                      <td className="p-3 text-muted-foreground">
                        {u.phone ? (
                          <a href={`tel:${u.phone}`} className="hover:text-orange-600 hover:underline">
                            {u.phone}
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={ROLE_TINT[u.role] || ''}>
                          {u.role === 'SUPER_ADMIN' && <ShieldCheck className="mr-1 h-3 w-3" />}
                          {ROLE_LABELS[u.role] || u.role}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {u.branch?.name ? (
                          <div>
                            <span className="text-sm">{u.branch.name}</span>
                            {isSuperAdmin && u.restaurant?.name && (
                              <span className="block text-[10px] text-muted-foreground">
                                {u.restaurant.name}
                              </span>
                            )}
                          </div>
                        ) : isSuperAdmin && u.restaurant?.name ? (
                          <span className="text-sm text-muted-foreground">{u.restaurant.name}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        <span className="text-xs" title={u.createdAt ? new Date(u.createdAt).toLocaleString() : undefined}>
                          {u.createdAt ? formatRelative(u.createdAt) : '—'}
                        </span>
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={u.active}
                          disabled={isManager && !u.active}
                          title={
                            isManager && !u.active
                              ? 'Only the restaurant owner can approve and activate accounts'
                              : undefined
                          }
                          onCheckedChange={() => handleToggleActive(u)}
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit"
                            onClick={() => {
                              setEditing(u)
                              setOpen(true)
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-orange-600"
                            title="Reset password"
                            onClick={() => openResetDialog(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <ConfirmDialog
                            trigger={
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" title="Remove">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                            title={`Remove ${u.name}?`}
                            description="This will deactivate the user. Their audit history will be preserved."
                            confirmLabel="Remove"
                            variant="destructive"
                            onConfirm={() => handleDelete(u)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit / Create dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit staff' : 'Add staff'}</DialogTitle>
            <DialogDescription>
              Choose a role carefully — it controls what they can access.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Full name</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editing.email}
                  disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </div>
              <div>
                <Label>{editing.id ? 'New password (optional)' : 'Password'}</Label>
                <Input
                  type="password"
                  value={editing.password || ''}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  placeholder={editing.id ? 'Leave blank to keep current' : 'Min 6 characters'}
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={editing.role}
                  onValueChange={(v) => setEditing({ ...editing, role: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r === 'SUPER_ADMIN' && '🛡️ '}{ROLE_LABELS[r] || r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {branches.length > 0 && !isManager && (
                  <div className="mt-2">
                    <Label>Branch (optional)</Label>
                    <Select
                      value={editing.branchId || '__none__'}
                      onValueChange={(v) =>
                        setEditing({ ...editing, branchId: v === '__none__' ? '' : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Restaurant-wide" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          All branches (restaurant-wide)
                        </SelectItem>
                        {branches.map((b: any) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Assign to a branch to scope this staff member to that location only.
                    </p>
                  </div>
                )}
                {isManager && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    This staff member will be assigned to your branch and activated only after
                    the restaurant owner approves the request.
                  </p>
                )}
                {editing.role && (
                  <div className="mt-2 rounded-lg border bg-slate-50 p-2">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Permissions for {ROLE_LABELS[editing.role] || editing.role}</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(PERMISSIONS)
                        .filter(([, roles]) => roles.includes(editing.role))
                        .map(([perm]) => (
                          <span key={perm} className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                            {perm.replace(/\./g, ' ').replace(/_/g, ' ')}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </div>
              {editing.id && !isManager && (
                <label className="flex items-center gap-2">
                  <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <span className="text-sm">Active</span>
                </label>
              )}
              {editing.id && isManager && (
                <p className="text-xs text-muted-foreground">
                  Activation is controlled by the restaurant owner's approval.
                </p>
              )}
              {editing.id && editing.createdAt && (
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    Added {formatRelative(editing.createdAt)}
                    {editing.branch?.name && ` · ${editing.branch.name}`}
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <ButtonWithLoading
              onClick={handleSave}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {editing?.id ? 'Save' : 'Create'}
            </ButtonWithLoading>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog
        open={resetOpen}
        onOpenChange={(o) => {
          setResetOpen(o)
          if (!o) {
            setResetTarget(null)
            setResetPassword('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-orange-600" />
              Reset password
            </DialogTitle>
            <DialogDescription>
              {resetTarget
                ? `Set a new password for ${resetTarget.name}. They'll need to use it the next time they sign in.`
                : 'Set a new password for this staff member.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New password</Label>
              <Input
                type="password"
                autoFocus
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Min 6 characters"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveReset()
                }}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                This will immediately replace the current password.
              </p>
            </div>
            {resetTarget?.createdAt && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Added {formatRelative(resetTarget.createdAt)}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <ButtonWithLoading
              onClick={handleSaveReset}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              Reset password
            </ButtonWithLoading>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
