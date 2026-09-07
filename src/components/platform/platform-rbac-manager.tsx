'use client'

import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Loader2, Shield, LayoutGrid, Save, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/hooks/api'
import { ROLE_LABELS } from '@/lib/auth'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceSpec {
  key: string
  label: string
  actions: string[]
}

interface ModuleSpec {
  key: string
  label: string
  group: 'platform' | 'restaurant'
}

interface PermissionsResponse {
  resources: ResourceSpec[]
  roles: string[]
  matrix: Record<string, Record<string, boolean>>
  superAdminNote: string
}

interface ModulesResponse {
  modules: ModuleSpec[]
  roles: string[]
  matrix: Record<string, Record<string, boolean>>
  superAdminNote: string
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPermissions(): Promise<PermissionsResponse> {
  return api<PermissionsResponse>('/api/platform/rbac/permissions')
}

async function fetchModules(): Promise<ModulesResponse> {
  return api<ModulesResponse>('/api/platform/rbac/modules')
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlatformRbacManager() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RBAC & Modules</h1>
          <p className="text-sm text-muted-foreground">
            Granular role-based access control. Toggle which role can perform
            each CRUD action, and which sidebar modules each role sees.
          </p>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-3 text-sm text-amber-900">
          <strong>Note:</strong> SUPER_ADMIN always has every permission and
          sees every module — it cannot be restricted. Changes take effect
          within 30 seconds for already-logged-in users (cache TTL).
        </CardContent>
      </Card>

      <Tabs defaultValue="permissions">
        <TabsList>
          <TabsTrigger value="permissions">
            <Shield className="mr-2 h-4 w-4" />
            Permissions (CRUD)
          </TabsTrigger>
          <TabsTrigger value="modules">
            <LayoutGrid className="mr-2 h-4 w-4" />
            Module visibility
          </TabsTrigger>
        </TabsList>
        <TabsContent value="permissions">
          <PermissionsMatrix />
        </TabsContent>
        <TabsContent value="modules">
          <ModulesMatrix />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Permissions (CRUD) matrix
// ---------------------------------------------------------------------------

function PermissionsMatrix() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: fetchPermissions,
  })

  // Local working copy so users can toggle many cells before saving.
  const [working, setWorking] = useState<Record<string, Record<string, boolean>> | null>(null)

  // Sync working copy when server data loads
  if (data && !working) {
    setWorking(data.matrix)
  }

  const saveMutation = useMutation({
    mutationFn: async (updates: Array<{ role: string; resource: string; action: string; allowed: boolean }>) => {
      return api('/api/platform/rbac/permissions', {
        method: 'PUT',
        body: JSON.stringify({ updates }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-permissions'] })
      qc.invalidateQueries({ queryKey: ['rbac-me'] })
      toast.success('Permissions saved')
      setWorking(null)
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save permissions')
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-600">
          {error.message || 'Failed to load permissions'}
        </CardContent>
      </Card>
    )
  }

  if (!data || !working) return null

  // Compute the diff between the server matrix and the working copy so the
  // "Save" button shows how many changes are pending.
  const diffs: Array<{ role: string; resource: string; action: string; allowed: boolean }> = []
  for (const role of data.roles) {
    for (const res of data.resources) {
      for (const action of res.actions) {
        const key = `${res.key}.${action}`
        const original = data.matrix[role]?.[key] ?? false
        const current = working[role]?.[key] ?? false
        if (original !== current) {
          diffs.push({ role, resource: res.key, action, allowed: current })
        }
      }
    }
  }

  const toggle = (role: string, resource: string, action: string, value: boolean) => {
    setWorking((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      next[role] = { ...next[role] }
      next[role][`${resource}.${action}`] = value
      return next
    })
  }

  const reset = () => setWorking(data.matrix)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Toggle each (role × resource × action) cell. Green = allowed,
          red = denied. Empty cells fall back to the system default.
        </p>
        <div className="flex gap-2">
          {diffs.length > 0 && (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Reset ({diffs.length})
            </Button>
          )}
          <Button
            size="sm"
            className="bg-orange-600 text-white hover:bg-orange-700"
            disabled={diffs.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate(diffs)}
          >
            <Save className="mr-2 h-3.5 w-3.5" />
            {saveMutation.isPending
              ? 'Saving…'
              : `Save ${diffs.length > 0 ? `(${diffs.length})` : ''}`}
          </Button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Resource · Action
                </th>
                {data.roles.map((role) => (
                  <th key={role} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ROLE_LABELS[role] || role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.resources.map((res) => (
                <Fragment key={`grp-${res.key}`}>
                  {/* Resource header row */}
                  <tr className="border-b bg-slate-100/50">
                    <td colSpan={data.roles.length + 1} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                      {res.label}
                      <span className="ml-2 text-muted-foreground">({res.key})</span>
                    </td>
                  </tr>
                  {res.actions.map((action) => (
                    <tr key={`${res.key}-${action}`} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {action}
                          </Badge>
                          <span className="text-muted-foreground">
                            {actionLabel(action)}
                          </span>
                        </span>
                      </td>
                      {data.roles.map((role) => {
                        const key = `${res.key}.${action}`
                        const value = working[role]?.[key] ?? false
                        const original = data.matrix[role]?.[key] ?? false
                        const dirty = value !== original
                        return (
                          <td key={role} className="px-3 py-2 text-center">
                            <button
                              onClick={() => toggle(role, res.key, action, !value)}
                              className={cn(
                                'inline-flex h-7 w-7 items-center justify-center rounded-md border-2 text-xs font-bold transition-colors',
                                value
                                  ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                                  : 'border-slate-300 bg-white text-slate-400 hover:border-red-400 hover:bg-red-50',
                                dirty && 'ring-2 ring-amber-400 ring-offset-1',
                              )}
                              aria-label={`${ROLE_LABELS[role]} ${action} on ${res.label}: ${value ? 'Allowed' : 'Denied'}`}
                              title={`${ROLE_LABELS[role]} — ${res.label} ${action}: ${value ? 'Allowed' : 'Denied'}${dirty ? ' (unsaved)' : ''}`}
                            >
                              {value ? '✓' : '✕'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATE: 'Create new records',
    READ: 'View records',
    UPDATE: 'Edit existing records',
    DELETE: 'Remove records',
    VIEW: 'View this module',
    MANAGE: 'Full management',
    VERIFY: 'Verify records',
    UPDATE_STATUS: 'Change order status',
    CANCEL: 'Cancel orders',
  }
  return map[action] || action
}

// ---------------------------------------------------------------------------
// Module visibility matrix
// ---------------------------------------------------------------------------

function ModulesMatrix() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['rbac-modules'],
    queryFn: fetchModules,
  })

  const [working, setWorking] = useState<Record<string, Record<string, boolean>> | null>(null)
  if (data && !working) setWorking(data.matrix)

  const saveMutation = useMutation({
    mutationFn: async (updates: Array<{ role: string; moduleKey: string; visible: boolean }>) => {
      return api('/api/platform/rbac/modules', {
        method: 'PUT',
        body: JSON.stringify({ updates }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac-modules'] })
      qc.invalidateQueries({ queryKey: ['rbac-me'] })
      toast.success('Module visibility saved')
      setWorking(null)
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save'),
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-600">
          {error.message || 'Failed to load modules'}
        </CardContent>
      </Card>
    )
  }

  if (!data || !working) return null

  const diffs: Array<{ role: string; moduleKey: string; visible: boolean }> = []
  for (const role of data.roles) {
    for (const mod of data.modules) {
      const original = data.matrix[role]?.[mod.key] ?? false
      const current = working[role]?.[mod.key] ?? false
      if (original !== current) {
        diffs.push({ role, moduleKey: mod.key, visible: current })
      }
    }
  }

  const toggle = (role: string, moduleKey: string, value: boolean) => {
    setWorking((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      next[role] = { ...next[role] }
      next[role][moduleKey] = value
      return next
    })
  }

  const reset = () => setWorking(data.matrix)

  // Group modules by group (platform / restaurant)
  const platformModules = data.modules.filter((m) => m.group === 'platform')
  const restaurantModules = data.modules.filter((m) => m.group === 'restaurant')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Toggle which sidebar modules each role sees. Hidden modules are
          completely removed from the sidebar AND their direct API access is
          blocked (via the permission check).
        </p>
        <div className="flex gap-2">
          {diffs.length > 0 && (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Reset ({diffs.length})
            </Button>
          )}
          <Button
            size="sm"
            className="bg-orange-600 text-white hover:bg-orange-700"
            disabled={diffs.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate(diffs)}
          >
            <Save className="mr-2 h-3.5 w-3.5" />
            {saveMutation.isPending
              ? 'Saving…'
              : `Save ${diffs.length > 0 ? `(${diffs.length})` : ''}`}
          </Button>
        </div>
      </div>

      <ModuleGroup
        title="Platform modules"
        description="Super-admin console — typically only SUPER_ADMIN sees these."
        modules={platformModules}
        roles={data.roles}
        working={working}
        original={data.matrix}
        onToggle={toggle}
      />

      <ModuleGroup
        title="Restaurant modules"
        description="Tenant-scoped modules — control which roles see what in their day-to-day."
        modules={restaurantModules}
        roles={data.roles}
        working={working}
        original={data.matrix}
        onToggle={toggle}
      />
    </div>
  )
}

function ModuleGroup({
  title,
  description,
  modules,
  roles,
  working,
  original,
  onToggle,
}: {
  title: string
  description: string
  modules: ModuleSpec[]
  roles: string[]
  working: Record<string, Record<string, boolean>>
  original: Record<string, Record<string, boolean>>
  onToggle: (role: string, moduleKey: string, value: boolean) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Module
                </th>
                {roles.map((role) => (
                  <th key={role} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ROLE_LABELS[role] || role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((mod) => (
                <tr key={mod.key} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    <div className="font-medium">{mod.label}</div>
                    <div className="text-xs text-muted-foreground">{mod.key}</div>
                  </td>
                  {roles.map((role) => {
                    const value = working[role]?.[mod.key] ?? false
                    const orig = original[role]?.[mod.key] ?? false
                    const dirty = value !== orig
                    return (
                      <td key={role} className="px-3 py-2.5 text-center">
                        <div className={cn('inline-flex items-center justify-center', dirty && 'ring-2 ring-amber-400 rounded-md')}>
                          <Switch
                            checked={value}
                            onCheckedChange={(v) => onToggle(role, mod.key, v)}
                            aria-label={`${ROLE_LABELS[role]} sees ${mod.label}`}
                          />
                        </div>
      {dirty && (
                                <span className="ml-1 text-[10px] text-amber-600">●</span>
                              )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
