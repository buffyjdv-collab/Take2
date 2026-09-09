'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  UtensilsCrossed,
  LayoutGrid,
  Table2,
  Users,
  Clock,
  Check,
  X,
  Building2,
} from 'lucide-react'
import { useAdminApprovals, useReviewApproval, type ApprovalRequestRow } from '@/hooks/api'
import { toast } from 'sonner'
import { LoadingSpinner, EmptyState } from '@/components/restaurant/loading-states'

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  MENU_CATEGORY: { label: 'Category', icon: LayoutGrid, color: 'bg-amber-100 text-amber-700' },
  MENU_ITEM: { label: 'Menu item', icon: UtensilsCrossed, color: 'bg-orange-100 text-orange-700' },
  TABLE: { label: 'Table', icon: Table2, color: 'bg-blue-100 text-blue-700' },
  STAFF: { label: 'Staff', icon: Users, color: 'bg-purple-100 text-purple-700' },
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function ApprovalsManager() {
  const [status, setStatus] = useState('PENDING')
  const [type, setType] = useState('ALL')
  const [rejecting, setRejecting] = useState<ApprovalRequestRow | null>(null)
  const [note, setNote] = useState('')

  const { data, isLoading } = useAdminApprovals(status, type)
  const review = useReviewApproval()

  const requests = data?.requests || []
  const counts = data?.counts

  const act = (row: ApprovalRequestRow, action: 'APPROVE' | 'REJECT', reviewNote?: string) => {
    review.mutate(
      { entityType: row.entityType, entityId: row.id, action, note: reviewNote },
      {
        onSuccess: () => {
          toast.success(
            action === 'APPROVE'
              ? `${TYPE_META[row.entityType].label} approved — it is now live`
              : `${TYPE_META[row.entityType].label} rejected`,
          )
          setRejecting(null)
          setNote('')
        },
        onError: (e: any) => toast.error(e?.message || 'Action failed'),
      },
    )
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Approvals</h1>
          <p className="text-sm text-slate-500">
            Menu categories, items, tables and staff created by branch managers need your
            sign-off before going live.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">
              Pending{counts ? ` (${counts.PENDING.all})` : ''}
            </SelectItem>
            <SelectItem value="REJECTED">
              Rejected{counts ? ` (${counts.REJECTED.all})` : ''}
            </SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="ALL">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {Object.entries(TYPE_META).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.label}
                {status === 'PENDING' && counts
                  ? ` (${counts.PENDING[k as keyof typeof counts.PENDING]})`
                  : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Check className="mx-auto mb-3 h-10 w-10 text-green-500" />
            <p className="font-medium text-slate-700">
              {status === 'PENDING'
                ? 'All caught up — nothing awaiting approval'
                : 'No requests match this filter'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              New submissions from branch managers will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((row) => {
            const meta = TYPE_META[row.entityType]
            const Icon = meta.icon
            const busy = review.isPending && review.variables?.entityId === row.id
            return (
              <Card key={`${row.entityType}-${row.id}`}>
                <CardContent className="flex flex-wrap items-start gap-3 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{row.title}</p>
                      <Badge className={STATUS_BADGE[row.status]}>{row.status}</Badge>
                      {row.branchName ? (
                        <Badge variant="outline" className="gap-1">
                          <Building2 className="h-3 w-3" /> {row.branchName}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{row.detail}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {timeAgo(row.createdAt)}
                      </span>
                      {row.requestedByName ? <span>· requested by {row.requestedByName}</span> : null}
                    </p>
                    {row.status === 'REJECTED' && row.reviewNote ? (
                      <p className="mt-1 text-xs text-red-500">
                        Rejected by {row.reviewedByName || 'owner'}: “{row.reviewNote}”
                      </p>
                    ) : null}
                  </div>
                  {row.status === 'PENDING' ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        disabled={busy}
                        onClick={() => act(row, 'APPROVE')}
                      >
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        disabled={busy}
                        onClick={() => {
                          setRejecting(row)
                          setNote('')
                        }}
                      >
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting ? TYPE_META[rejecting.entityType].label.toLowerCase() : ''}</DialogTitle>
            <DialogDescription>
              {rejecting?.title} stays hidden/inactive until the branch manager updates and
              resubmits it. Tell them why so they can fix it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Reason (optional)</Label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Price too low — check food cost, or duplicate of an existing category"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={review.isPending}
              onClick={() => rejecting && act(rejecting, 'REJECT', note)}
            >
              <X className="mr-1 h-4 w-4" /> Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
