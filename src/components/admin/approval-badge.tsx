'use client'

import { Badge } from '@/components/ui/badge'
import { Clock, XCircle, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared owner-approval status badge.
 *
 * Used by the Menu, Tables and Staff managers so the approval workflow looks
 * (and is worded) identically everywhere. Renders nothing for APPROVED
 * entities — an absence of a badge means "live".
 */
export function ApprovalBadge({
  status,
  reviewNote,
  className,
}: {
  status?: string | null
  reviewNote?: string | null
  className?: string
}) {
  if (status === 'PENDING') {
    return (
      <Badge className={cn('gap-1 bg-amber-100 text-amber-700 hover:bg-amber-100', className)}>
        <Clock className="h-3 w-3" /> Pending approval
      </Badge>
    )
  }
  if (status === 'REJECTED') {
    return (
      <Badge
        className={cn('gap-1 bg-red-100 text-red-700 hover:bg-red-100', className)}
        title={reviewNote || 'Rejected by the owner'}
      >
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    )
  }
  return null
}

/** Small chip showing which branch owns an entity (null = shared). */
export function BranchChip({
  branchName,
  className,
}: {
  branchName?: string | null
  className?: string
}) {
  if (!branchName) return null
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal text-slate-500', className)}>
      <Building2 className="h-3 w-3" /> {branchName}
    </Badge>
  )
}

/** Helper banner for branch managers explaining the approval flow. */
export function ManagerApprovalHint({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {what} you create are submitted to the <b>restaurant owner</b> for approval and go
      live only after sign-off. Rejected entries show a note — edit and save to resubmit.
    </div>
  )
}
