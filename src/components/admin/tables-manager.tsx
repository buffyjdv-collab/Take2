'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAdminTables, useAdminBranches, api } from '@/hooks/api'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Plus, Pencil, QrCode, Download, RefreshCw, Printer, Users, ExternalLink, Copy, Check, MapPin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner, EmptyState, ButtonWithLoading } from '@/components/restaurant/loading-states'
import { ConfirmDialog } from '@/components/restaurant/confirm-dialog'
import { OrderStatusBadge } from '@/components/restaurant/order-status-badge'
import { ApprovalBadge, ManagerApprovalHint } from './approval-badge'

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-700',
  OCCUPIED: 'bg-orange-100 text-orange-700',
  ORDERING: 'bg-blue-100 text-blue-700',
  FOOD_PREPARING: 'bg-amber-100 text-amber-700',
  BILL_REQUESTED: 'bg-purple-100 text-purple-700',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-slate-100 text-slate-700',
}

export function TablesManager() {
  const { data: session } = useSession()
  const isManager = session?.user?.role === 'MANAGER'
  // Branch-wise filtering is an owner / super-admin capability — branch-scoped
  // roles see only their own branch's tables (server-forced), so the selector
  // is hidden for them.
  const canFilterBranch =
    session?.user?.role === 'RESTAURANT_OWNER' || session?.user?.role === 'SUPER_ADMIN'
  // 'all' (default) | '<branchId>' | 'none' (restaurant-wide tables)
  const [branchView, setBranchView] = useState<string>('all')
  const { data, isLoading } = useAdminTables(
    canFilterBranch && branchView !== 'all' ? { branchId: branchView } : {},
  )
  const { data: branchData } = useAdminBranches(canFilterBranch)
  const branches = branchData?.branches || []
  const branchLabel =
    branchView === 'none'
      ? 'restaurant-wide tables'
      : branches.find((b: any) => b.id === branchView)?.name
  const qc = useQueryClient()
  const [editing, setEditing] = useState<any | null>(null)
  const [open, setOpen] = useState(false)
  const [qrTable, setQrTable] = useState<any | null>(null)
  const [qrInfo, setQrInfo] = useState<{ dataUrl: string; url: string } | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleNew = () => {
    // Single visible branch (e.g. a branch manager scoped to one location, or
    // a single-branch restaurant) → default new tables to it.
    const defaultBranchId = branches.length === 1 ? branches[0].id : ''
    setEditing({ number: '', label: '', capacity: 4, active: true, branchId: defaultBranchId })
    setOpen(true)
  }

  const handleSave = async () => {
    try {
      if (editing.id) {
        await api(`/api/admin/tables/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editing),
        })
        toast.success('Table updated')
      } else {
        await api(`/api/admin/tables`, {
          method: 'POST',
          body: JSON.stringify(editing),
        })
        toast.success('Table created')
      }
      qc.invalidateQueries({ queryKey: ['admin-tables'] })
      setOpen(false)
      setEditing(null)
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    }
  }

  const handleDelete = async (t: any) => {
    try {
      await api(`/api/admin/tables/${t.id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey: ['admin-tables'] })
      toast.success('Table deleted — order history preserved')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleViewQr = async (t: any) => {
    setQrTable(t)
    setQrInfo(null)
    setCopied(false)
    try {
      const res = await api<any>(`/api/admin/tables/${t.id}/qr?format=dataurl`)
      setQrInfo({ dataUrl: res.dataUrl, url: res.url })
    } catch (err: any) {
      toast.error(err.message || 'Failed to load QR')
    }
  }

  const handleRegenerate = async () => {
    if (!qrTable) return
    setRegenerating(true)
    try {
      const res = await api<any>(`/api/admin/tables/${qrTable.id}/qr`, { method: 'POST' })
      qc.invalidateQueries({ queryKey: ['admin-tables'] })
      toast.success('QR token regenerated — old QR codes no longer work')
      // Re-fetch data URL
      const r2 = await api<any>(`/api/admin/tables/${qrTable.id}/qr?format=dataurl`)
      setQrInfo({ dataUrl: r2.dataUrl, url: r2.url })
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tables & QR codes</h1>
          <p className="text-sm text-muted-foreground">
            {canFilterBranch && branchView !== 'all' && branchLabel
              ? `${data?.length || 0} ${branchLabel} · click any to view QR`
              : `${data?.length || 0} tables · click any to view QR`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canFilterBranch && (
            <Select
              value={branchView}
              onValueChange={(v) => setBranchView(v)}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">No branch (restaurant-wide)</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleNew} className="bg-orange-600 text-white hover:bg-orange-700">
            <Plus className="mr-2 h-4 w-4" /> Add table
          </Button>
        </div>
      </div>

      {isManager && <ManagerApprovalHint what="Tables" />}

      {isLoading ? (
        <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
      ) : !data?.length ? (
        <EmptyState
          title="No tables yet"
          description="Add your first table to generate its QR code."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((t: any) => {
            const activeOrder = t.orders?.[0]
            return (
              <Card key={t.id} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="text-lg font-bold">{t.number}</p>
                      {t.label && (
                        <p className="text-xs text-muted-foreground">{t.label}</p>
                      )}
                      <div className="mt-1">
                        <ApprovalBadge status={t.approvalStatus} reviewNote={t.reviewNote} />
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[t.status] || 'bg-slate-100'}`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{t.capacity} seats</span>
                    {t.branch?.name && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                        <MapPin className="h-2.5 w-2.5" /> {t.branch.name}
                      </span>
                    )}
                  </div>
                  {activeOrder && (
                    <div className="mb-2 rounded-md bg-slate-50 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{activeOrder.orderNumber}</span>
                        <OrderStatusBadge status={activeOrder.status} />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleViewQr(t)}
                    >
                      <QrCode className="mr-1 h-3 w-3" /> QR
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Edit"
                      onClick={() => {
                        setEditing(t)
                        setOpen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600"
                          title="Delete table"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title={`Delete table ${t.number}?`}
                      description="This permanently removes the table and its QR code. Past orders are kept in your reports and history."
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={() => handleDelete(t)}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Edit / new dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit table' : 'Add table'}</DialogTitle>
            <DialogDescription>
              Each table gets its own unique QR code for customer ordering.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Number / label</Label>
                <Input
                  value={editing.number}
                  onChange={(e) => setEditing({ ...editing, number: e.target.value })}
                  placeholder="e.g. T1, Patio-2"
                />
              </div>
              <div>
                <Label>Friendly name (optional)</Label>
                <Input
                  value={editing.label || ''}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="e.g. Window seat"
                />
              </div>
              <div>
                <Label>Capacity</Label>
                <Input
                  type="number"
                  value={editing.capacity}
                  onChange={(e) => setEditing({ ...editing, capacity: parseInt(e.target.value) || 4 })}
                />
              </div>
              {branches.length > 0 && (
                <div>
                  <Label>Branch</Label>
                  <Select
                    value={editing.branchId || '__none__'}
                    onValueChange={(v) =>
                      setEditing({ ...editing, branchId: v === '__none__' ? '' : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        No branch (restaurant-wide)
                      </SelectItem>
                      {branches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Orders placed at this table are counted towards the branch.
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                <span className="text-sm">Active (visible to customers)</span>
              </label>
            </div>
          )}
          <DialogFooter className="flex justify-between">
            {editing?.id && (
              <ConfirmDialog
                trigger={
                  <Button variant="destructive">
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                }
                title={`Delete table ${editing.number}?`}
                description="This permanently removes the table and its QR code. Past orders are kept in your reports and history."
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => {
                  handleDelete(editing)
                  setOpen(false)
                }}
              />
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <ButtonWithLoading
                onClick={handleSave}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                {editing?.id ? 'Save' : 'Create'}
              </ButtonWithLoading>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR viewer */}
      <Sheet open={!!qrTable} onOpenChange={(o) => !o && setQrTable(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>QR code · Table {qrTable?.number}</SheetTitle>
            <SheetDescription>
              Print this QR and place it on the table. Customers scan it to
              open your menu.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col items-center gap-4 px-4 pb-8">
            <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
              {qrInfo ? (
                 
                <img src={qrInfo.dataUrl} alt="QR code" className="h-56 w-56" />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center">
                  <LoadingSpinner size="lg" />
                </div>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Scanning this QR auto-opens the menu at:
            </p>
            <code className="max-w-full break-all rounded bg-slate-100 px-2 py-1 text-center text-[11px] text-slate-600">
              {qrInfo?.url || '…'}
            </code>
            {/* Primary actions — open the exact URL customers get on scan,
                or copy it to send via WhatsApp / print on a table card. */}
            <div className="grid w-full grid-cols-2 gap-2">
              <Button
                disabled={!qrInfo}
                className="bg-orange-600 text-white hover:bg-orange-700"
                onClick={() => qrInfo && window.open(qrInfo.url, '_blank', 'noopener')}
              >
                <ExternalLink className="mr-1 h-4 w-4" /> Test scan
              </Button>
              <Button
                variant="outline"
                disabled={!qrInfo}
                onClick={async () => {
                  if (!qrInfo) return
                  try {
                    await navigator.clipboard.writeText(qrInfo.url)
                    setCopied(true)
                    toast.success('Menu link copied')
                    setTimeout(() => setCopied(false), 2000)
                  } catch {
                    toast.error('Copy failed — long-press the link to copy')
                  }
                }}
              >
                {copied ? (
                  <Check className="mr-1 h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="mr-1 h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <div className="grid w-full grid-cols-3 gap-2">
              <Button
                variant="outline"
                disabled={!qrInfo}
                onClick={() => {
                  if (!qrInfo) return
                  const a = document.createElement('a')
                  a.href = qrInfo.dataUrl
                  a.download = `qr-table-${qrTable?.number}.png`
                  a.click()
                }}
              >
                <Download className="mr-1 h-4 w-4" /> Save
              </Button>
              <Button
                variant="outline"
                disabled={!qrInfo}
                onClick={() => {
                  if (!qrInfo) return
                  const w = window.open('', '_blank')
                  if (w) {
                    w.document.write(
                      `<img src="${qrInfo.dataUrl}" style="width:300px"/><script>window.print()</script>`,
                    )
                  }
                }}
              >
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={regenerating}>
                    <RefreshCw className={`mr-1 h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
                    Regen
                  </Button>
                }
                title="Regenerate QR token?"
                description="The old QR code will stop working immediately. New prints will be needed."
                confirmLabel="Regenerate"
                variant="destructive"
                onConfirm={handleRegenerate}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
