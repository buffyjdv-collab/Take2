'use client'

/**
 * Zepto-style Payment Methods Manager.
 *
 * Renders inside the Settings → Payments tab. Lets the restaurant owner:
 *   - Toggle which payment methods are visible at checkout
 *   - Edit each method's label, description, icon, accent color, config
 *   - Reorder methods (priority — lower = appears first)
 *   - Delete methods they no longer want
 *   - Add new methods from a catalog of presets (UPI / Card / Wallet / NetBanking / Cash / Counter / Pay Later / Custom)
 *
 * Driven by:
 *   - GET    /api/admin/payment-methods
 *   - POST   /api/admin/payment-methods           (create)
 *   - PATCH  /api/admin/payment-methods/[id]      (update)
 *   - DELETE /api/admin/payment-methods/[id]      (delete)
 *   - POST   /api/admin/payment-methods/reorder   (reorder)
 */
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  usePaymentMethods,
  useCreatePaymentMethod,
  useUpdatePaymentMethod,
  useDeletePaymentMethod,
  useReorderPaymentMethods,
  api,
} from '@/hooks/api'
import { LoadingSpinner, EmptyState, ButtonWithLoading } from '@/components/restaurant/loading-states'
import { toast } from 'sonner'
import {
  Smartphone,
  QrCode,
  CreditCard,
  Wallet,
  Building2,
  Banknote,
  Store,
  Clock,
  Plus,
  Trash2,
  Edit2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Copy,
  type LucideIcon,
} from 'lucide-react'

const ICON_OPTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'Smartphone', Icon: Smartphone },
  { name: 'QrCode', Icon: QrCode },
  { name: 'CreditCard', Icon: CreditCard },
  { name: 'Wallet', Icon: Wallet },
  { name: 'Building2', Icon: Building2 },
  { name: 'Banknote', Icon: Banknote },
  { name: 'Store', Icon: Store },
  { name: 'Clock', Icon: Clock },
  { name: 'Plus', Icon: Plus },
]

const ACCENT_PRESETS = [
  '#7C3AED', // violet (UPI)
  '#9333EA', // purple (QR)
  '#2563EB', // blue (CARD)
  '#F59E0B', // amber (WALLET)
  '#0891B2', // cyan (NETBANKING)
  '#16A34A', // green (CASH)
  '#DB2777', // pink (COUNTER)
  '#EA580C', // orange (PAY_LATER)
  '#64748B', // slate (CUSTOM)
]

interface Props {
  /** Restaurant ID — super admins pass it explicitly; regular users leave undefined */
  restaurantId?: string
}

interface EditFormState {
  id?: string
  type: string
  label: string
  description: string
  icon: string
  accentColor: string
  active: boolean
  priority: number
  config: Record<string, any>
}

export function PaymentMethodsManager({ restaurantId }: Props) {
  const { data, isLoading, error } = usePaymentMethods(restaurantId)
  const createMu = useCreatePaymentMethod(restaurantId)
  const updateMu = useUpdatePaymentMethod(restaurantId)
  const deleteMu = useDeletePaymentMethod(restaurantId)
  const reorderMu = useReorderPaymentMethods(restaurantId)

  const [editing, setEditing] = useState<EditFormState | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [addCatalogOpen, setAddCatalogOpen] = useState(false)

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <LoadingSpinner size="md" />
        </CardContent>
      </Card>
    )
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState title="Couldn't load payment methods" description={(error as Error).message} />
        </CardContent>
      </Card>
    )
  }

  const methods = data?.methods ?? []
  const presets = data?.presets ?? []

  const handleOpenAdd = () => {
    setEditing(null)
    setAddCatalogOpen(true)
  }

  const handleOpenEdit = (m: any) => {
    setEditing({
      id: m.id,
      type: m.type,
      label: m.label,
      description: m.description || '',
      icon: m.icon || 'CreditCard',
      accentColor: m.accentColor || '#64748B',
      active: m.active,
      priority: m.priority,
      config: (m.config as any) || {},
    })
    setDialogOpen(true)
  }

  const handlePickPreset = (preset: any) => {
    setEditing({
      type: preset.type,
      label: preset.label,
      description: preset.description,
      icon: preset.icon,
      accentColor: preset.accentColor,
      active: true,
      priority: preset.priority,
      config: preset.config || {},
    })
    setAddCatalogOpen(false)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.label.trim()) {
      toast.error('Label is required')
      return
    }
    try {
      if (editing.id) {
        await updateMu.mutateAsync({
          id: editing.id,
          label: editing.label,
          description: editing.description || null,
          icon: editing.icon,
          accentColor: editing.accentColor,
          active: editing.active,
          priority: editing.priority,
          config: editing.config,
        })
        toast.success('Payment method updated')
      } else {
        await createMu.mutateAsync({
          type: editing.type as any,
          label: editing.label,
          description: editing.description || null,
          icon: editing.icon,
          accentColor: editing.accentColor,
          active: editing.active,
          priority: editing.priority,
          config: editing.config,
        })
        toast.success('Payment method added')
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (e: any) {
      toast.error(e.message || 'Save failed')
    }
  }

  const handleToggleActive = async (m: any) => {
    try {
      await updateMu.mutateAsync({ id: m.id, active: !m.active })
      toast.success(`${m.label} ${m.active ? 'disabled' : 'enabled'}`)
    } catch (e: any) {
      toast.error(e.message || 'Toggle failed')
    }
  }

  const handleDelete = async (m: any) => {
    if (!confirm(`Delete "${m.label}"? This can't be undone.`)) return
    try {
      await deleteMu.mutateAsync({ id: m.id })
      toast.success(`${m.label} deleted`)
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= methods.length) return
    const ordered = methods.map((m: any) => m.id)
    ;[ordered[idx], ordered[target]] = [ordered[target], ordered[idx]]
    try {
      await reorderMu.mutateAsync(ordered)
    } catch (e: any) {
      toast.error(e.message || 'Reorder failed')
    }
  }

  const activeCount = methods.filter((m: any) => m.active).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Payment methods</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure which payment options customers see at checkout.
            {' '}
            <span className="font-medium text-emerald-700">{activeCount} active</span>
            {' · '}
            <span className="font-medium text-slate-600">{methods.length} total</span>
          </p>
        </div>
        <Button
          onClick={handleOpenAdd}
          className="bg-orange-600 text-white hover:bg-orange-700"
          size="sm"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add method
        </Button>
      </CardHeader>
      <CardContent>
        {methods.length === 0 ? (
          <EmptyState
            title="No payment methods configured"
            description="Click 'Add method' to set up UPI, Cash, Card, Wallets, and more."
          />
        ) : (
          <div className="space-y-2">
            {methods.map((m: any, idx: number) => {
              const Icon = ICON_OPTIONS.find((i) => i.name === m.icon)?.Icon || CreditCard
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
                    m.active
                      ? 'border-slate-200 bg-white'
                      : 'border-dashed border-slate-200 bg-slate-50/50 opacity-70'
                  }`}
                >
                  {/* Color-tinted icon chip */}
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${m.accentColor}1A` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: m.accentColor }} />
                  </div>

                  {/* Label + description + type pill */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-slate-800">{m.label}</p>
                      <span
                        className="rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                        style={{ color: m.accentColor, borderColor: `${m.accentColor}40` }}
                      >
                        {m.type}
                      </span>
                    </div>
                    <p className="truncate text-[12px] text-slate-500">
                      {m.description || 'No description'}
                    </p>
                  </div>

                  {/* Reorder buttons */}
                  <div className="flex shrink-0 flex-col">
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0 || reorderMu.isPending}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === methods.length - 1 || reorderMu.isPending}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Toggle */}
                  <Switch checked={m.active} onCheckedChange={() => handleToggleActive(m)} />

                  {/* Edit + delete */}
                  <button
                    onClick={() => handleOpenEdit(m)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Edit"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(m)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Helper / "Recommended" explainer */}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Methods appear at checkout in priority order. The first one is badged
          as &ldquo;Recommended&rdquo; to customers. Drag using the arrows to
          reorder. Toggling a method off hides it from customers but keeps its
          settings intact.
        </p>
      </CardContent>

      {/* Edit / create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? 'Edit payment method' : 'Add payment method'}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <EditForm
              value={editing}
              onChange={setEditing}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <ButtonWithLoading
              onClick={handleSave}
              loading={createMu.isPending || updateMu.isPending}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {editing?.id ? 'Save changes' : 'Add method'}
            </ButtonWithLoading>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add (catalog) dialog */}
      <Dialog open={addCatalogOpen} onOpenChange={setAddCatalogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pick a payment type</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            {presets.map((p: any) => {
              const Icon = ICON_OPTIONS.find((i) => i.name === p.icon)?.Icon || CreditCard
              const alreadyHas = methods.some((m: any) => m.type === p.type)
              return (
                <button
                  key={p.type}
                  onClick={() => handlePickPreset(p)}
                  disabled={alreadyHas && p.type !== 'CUSTOM'}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-all hover:border-orange-300 hover:bg-orange-50/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${p.accentColor}1A` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: p.accentColor }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-slate-800">{p.label}</p>
                    <p className="text-[12px] text-slate-500">{p.description}</p>
                  </div>
                  {alreadyHas && p.type !== 'CUSTOM' ? (
                    <span className="text-[10px] font-semibold uppercase text-slate-400">
                      Already added
                    </span>
                  ) : (
                    <Plus className="h-4 w-4 text-slate-400" />
                  )}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/**
 * Inline edit form. Lets the owner tweak every field on a payment method.
 */
function EditForm({
  value,
  onChange,
}: {
  value: EditFormState
  onChange: (v: EditFormState) => void
}) {
  const set = (patch: Partial<EditFormState>) => onChange({ ...value, ...patch })
  const setConfig = (key: string, v: any) =>
    set({ config: { ...value.config, [key]: v } })

  // Render type-specific config fields
  const renderConfigFields = () => {
    switch (value.type) {
      case 'UPI':
        return (
          <Field label="UPI ID (VPA)">
            <Input
              value={value.config.upiId || ''}
              onChange={(e) => setConfig('upiId', e.target.value)}
              placeholder="restaurant@okhdfcbank"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Customers will see this VPA. A QR code is auto-generated from it.
            </p>
          </Field>
        )
      case 'QR':
        return (
          <Field label="QR payload override (optional)">
            <Input
              value={value.config.payload || ''}
              onChange={(e) => setConfig('payload', e.target.value)}
              placeholder="Leave blank to use the UPI deep-link"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave blank to use the standard UPI deep-link derived from your UPI ID.
            </p>
          </Field>
        )
      case 'CARD':
      case 'WALLET':
      case 'NETBANKING':
        return (
          <Field label="Provider">
            <Select
              value={value.config.provider || 'MOCK'}
              onValueChange={(v) => setConfig('provider', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MOCK">Mock (demo)</SelectItem>
                <SelectItem value="RAZORPAY">Razorpay</SelectItem>
                <SelectItem value="STRIPE">Stripe</SelectItem>
                <SelectItem value="PHONEPE">PhonePe</SelectItem>
                <SelectItem value="PAYTM">Paytm</SelectItem>
                <SelectItem value="MOBIKWIK">Mobikwik</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Mock is fine for testing — pick a real provider when ready to go live.
            </p>
          </Field>
        )
      case 'CASH':
      case 'COUNTER':
      case 'PAY_LATER':
      case 'CUSTOM':
      default:
        return null
    }
  }

  return (
    <div className="space-y-4 py-2">
      <Field label="Label">
        <Input value={value.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} />
      </Field>

      <Field label="Description">
        <Input
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={180}
          placeholder="e.g. GPay / PhonePe / Paytm"
        />
      </Field>

      <Field label="Icon">
        <div className="flex flex-wrap gap-2">
          {ICON_OPTIONS.map(({ name, Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => set({ icon: name })}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-all ${
                value.icon === name
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <Icon className="h-4 w-4" style={{ color: value.accentColor }} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Accent color">
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ accentColor: c })}
              className={`h-8 w-8 rounded-full border-2 transition-all ${
                value.accentColor === c ? 'border-slate-900' : 'border-white'
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
          <Input
            value={value.accentColor}
            onChange={(e) => set({ accentColor: e.target.value })}
            className="h-8 w-24"
            placeholder="#64748B"
          />
        </div>
      </Field>

      <Field label="Priority">
        <Input
          type="number"
          value={value.priority}
          onChange={(e) => set({ priority: parseInt(e.target.value || '0', 10) })}
          min={0}
          max={9999}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Lower numbers appear first at checkout.
        </p>
      </Field>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
        <div>
          <p className="text-[13px] font-semibold text-slate-800">Active</p>
          <p className="text-[11px] text-muted-foreground">
            Inactive methods are hidden from customers but keep their settings.
          </p>
        </div>
        <Switch checked={value.active} onCheckedChange={(v) => set({ active: v })} />
      </div>

      {renderConfigFields()}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-semibold text-slate-700">{label}</Label>
      {children}
    </div>
  )
}
