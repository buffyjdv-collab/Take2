'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Price, formatINR } from '@/components/restaurant/price'
import { VegBadge } from '@/components/restaurant/veg-badge'
import { SpicyBadge } from '@/components/restaurant/spicy-badge'
import { EmptyState, LoadingSpinner, ButtonWithLoading } from '@/components/restaurant/loading-states'
import { ConfirmDialog } from '@/components/restaurant/confirm-dialog'
import { useAdminCategories, useAdminMenuItems, useAdminModifierGroups, api } from '@/hooks/api'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Star, Flame, X, UtensilsCrossed, Upload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function MenuManager() {
  const { data: categories, isLoading: catLoading } = useAdminCategories()
  const { data: items, isLoading: itemsLoading } = useAdminMenuItems()
  const qc = useQueryClient()

  const [activeCat, setActiveCat] = useState<string>('')
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [editCat, setEditCat] = useState<any | null>(null)

  const filteredItems = items?.filter((i: any) => i.categoryId === activeCat) || items

  const handleAddItem = () => {
    setEditingItem({
      name: '',
      description: '',
      image: '',
      categoryId: activeCat || categories?.[0]?.id || '',
      isVeg: true,
      isSpicy: false,
      basePrice: 0,
      taxRate: 0.05,
      available: true,
      soldOut: false,
      isFeatured: false,
      isPopular: false,
      prepTime: 15,
      tags: '',
      variants: [],
      modifierGroupIds: [],
    })
    setEditOpen(true)
  }

  const handleSaveItem = async () => {
    if (!editingItem) return
    try {
      if (editingItem.id) {
        await api(`/api/admin/menu/items/${editingItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editingItem),
        })
        toast.success('Item updated')
      } else {
        await api(`/api/admin/menu/items`, {
          method: 'POST',
          body: JSON.stringify(editingItem),
        })
        toast.success('Item created')
      }
      qc.invalidateQueries({ queryKey: ['admin-menu-items'] })
      setEditOpen(false)
      setEditingItem(null)
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    }
  }

  const handleToggleSoldOut = async (item: any) => {
    try {
      await api(`/api/admin/menu/items/${item.id}/soldout`, {
        method: 'PATCH',
        body: JSON.stringify({ soldOut: !item.soldOut }),
      })
      qc.invalidateQueries({ queryKey: ['admin-menu-items'] })
      toast.success(item.soldOut ? 'Marked available' : 'Marked sold out')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleDeleteItem = async (item: any) => {
    try {
      await api(`/api/admin/menu/items/${item.id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey: ['admin-menu-items'] })
      toast.success('Item deleted')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    try {
      await api(`/api/admin/menu/categories`, {
        method: 'POST',
        body: JSON.stringify({ name: newCatName.trim() }),
      })
      qc.invalidateQueries({ queryKey: ['admin-categories'] })
      setNewCatName('')
      setNewCatOpen(false)
      toast.success('Category added')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  return (
    <div className="grid gap-4 p-4 lg:p-6 lg:grid-cols-[260px_1fr]">
      {/* Categories sidebar */}
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Categories</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setNewCatOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-1 p-2">
          {catLoading && <LoadingSpinner />}
          {!catLoading &&
            categories?.map((c: any) => (
              <div
                key={c.id}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer',
                  activeCat === c.id
                    ? 'bg-orange-50 text-orange-700'
                    : 'hover:bg-slate-100',
                )}
                onClick={() => setActiveCat(c.id)}
              >
                {c.icon && <span>{c.icon}</span>}
                <span className="flex-1 font-medium">{c.name}</span>
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-muted-foreground">
                  {c._count?.menuItems || 0}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditCat(c)
                  }}
                  className="hidden group-hover:block text-muted-foreground hover:text-orange-600"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ))}
          {activeCat && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setActiveCat('')}
            >
              <X className="mr-2 h-3 w-3" /> Show all
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Menu</h1>
            <p className="text-sm text-muted-foreground">
              {filteredItems?.length || 0} items
            </p>
          </div>
          <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={handleAddItem}>
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
        </div>

        {itemsLoading ? (
          <div className="flex justify-center py-10">
            <LoadingSpinner size="lg" />
          </div>
        ) : !filteredItems || filteredItems.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed className="h-6 w-6" />}
            title="No items here yet"
            description="Add your first menu item to start taking orders."
            action={
              <Button onClick={handleAddItem} className="bg-orange-600 text-white hover:bg-orange-700">
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item: any) => (
              <Card key={item.id} className={cn('overflow-hidden', item.soldOut && 'opacity-60')}>
                <div className="flex gap-3 p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-orange-50">
                    {item.image ? (
                       
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl">🍽️</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <VegBadge isVeg={item.isVeg} />
                      {item.isSpicy && <Flame className="h-3 w-3 text-orange-600" />}
                      {item.isFeatured && (
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      )}
                    </div>
                    <p className="line-clamp-1 text-sm font-semibold">{item.name}</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <Price amount={item.basePrice} size="sm" />
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingItem(item)
                            setEditOpen(true)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          }
                          title={`Delete ${item.name}?`}
                          description="This item will be removed from your menu. Past orders will retain the snapshot."
                          confirmLabel="Delete"
                          variant="destructive"
                          onConfirm={() => handleDeleteItem(item)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t bg-slate-50 px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={!item.soldOut}
                      onCheckedChange={() => handleToggleSoldOut(item)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {item.soldOut ? 'Sold out' : 'Available'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {item.variants?.length > 0 && <span>{item.variants.length} variants</span>}
                    {item.modifierGroups?.length > 0 && (
                      <span>{item.modifierGroups.length} modifier groups</span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Item editor dialog */}
      <ItemEditor
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o)
          if (!o) setEditingItem(null)
        }}
        item={editingItem}
        categories={categories || []}
        modifierGroups={[]}
        onChange={setEditingItem}
        onSave={handleSaveItem}
      />

      {/* New category dialog */}
      <Dialog open={newCatOpen} onOpenChange={setNewCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
            <DialogDescription>Categories group items on the customer menu.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="e.g. Desserts, Beverages"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCategory} className="bg-orange-600 text-white hover:bg-orange-700">
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit category dialog */}
      <CategoryEditor
        category={editCat}
        onClose={() => setEditCat(null)}
      />
    </div>
  )
}

function ItemEditor({
  open,
  onOpenChange,
  item,
  categories,
  modifierGroups,
  onChange,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: any | null
  categories: any[]
  modifierGroups: any[]
  onChange: (item: any) => void
  onSave: () => void
}) {
  const [saving, setSaving] = useState(false)
  const { data: allModifierGroups } = useAdminModifierGroups()

  if (!item) return null

  const set = (patch: Record<string, any>) => onChange({ ...item, ...patch })

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  const addVariant = () => {
    set({
      variants: [
        ...(item.variants || []),
        { name: 'New variant', priceModifier: 0, isDefault: false, sortOrder: item.variants?.length || 0 },
      ],
    })
  }
  const updateVariant = (idx: number, patch: any) => {
    const next = [...item.variants]
    next[idx] = { ...next[idx], ...patch }
    set({ variants: next })
  }
  const removeVariant = (idx: number) => {
    set({ variants: item.variants.filter((_: any, i: number) => i !== idx) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.id ? 'Edit item' : 'Add item'}</DialogTitle>
          <DialogDescription>
            Customise the dish, its variants, and modifier groups.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={item.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={item.description || ''}
                onChange={(e) => set({ description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="col-span-2">
              <Label>Item image</Label>
              <ImageUploader
                value={item.image || ''}
                onChange={(url) => set({ image: url })}
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={item.categoryId}
                onValueChange={(v) => set({ categoryId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Base price (₹)</Label>
              <Input
                type="number"
                value={item.basePrice}
                onChange={(e) => set({ basePrice: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Tax rate (0–1)</Label>
              <Input
                type="number"
                step="0.01"
                value={item.taxRate}
                onChange={(e) => set({ taxRate: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Prep time (min)</Label>
              <Input
                type="number"
                value={item.prepTime}
                onChange={(e) => set({ prepTime: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Toggle
              label="Veg"
              checked={item.isVeg}
              onChange={(v) => set({ isVeg: v })}
            />
            <Toggle
              label="Spicy"
              checked={item.isSpicy}
              onChange={(v) => set({ isSpicy: v })}
            />
            <Toggle
              label="Featured"
              checked={item.isFeatured}
              onChange={(v) => set({ isFeatured: v })}
            />
            <Toggle
              label="Popular"
              checked={item.isPopular}
              onChange={(v) => set({ isPopular: v })}
            />
            <Toggle
              label="Available"
              checked={item.available}
              onChange={(v) => set({ available: v })}
            />
            <Toggle
              label="Sold out"
              checked={item.soldOut}
              onChange={(v) => set({ soldOut: v })}
            />
          </div>

          {/* Variants */}
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-sm font-semibold">Variants</Label>
              <Button size="sm" variant="outline" onClick={addVariant}>
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {(item.variants || []).map((v: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="Name"
                    value={v.name}
                    onChange={(e) => updateVariant(idx, { name: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    placeholder="± ₹"
                    value={v.priceModifier}
                    onChange={(e) => updateVariant(idx, { priceModifier: parseFloat(e.target.value) || 0 })}
                    className="w-24"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={v.isDefault}
                      onChange={(e) => updateVariant(idx, { isDefault: e.target.checked })}
                    />
                    Default
                  </label>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => removeVariant(idx)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {(!item.variants || item.variants.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  No variants — customers will order the base item.
                </p>
              )}
            </div>
          </div>

          {/* Modifier groups */}
          <div className="rounded-lg border p-3">
            <Label className="mb-2 block text-sm font-semibold">Modifier groups</Label>
            <div className="space-y-1.5">
              {(allModifierGroups || []).map((g: any) => {
                const selected = (item.modifierGroupIds || []).includes(g.id)
                return (
                  <label
                    key={g.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm',
                      selected ? 'border-orange-500 bg-orange-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...(item.modifierGroupIds || []), g.id]
                          : (item.modifierGroupIds || []).filter((id: string) => id !== g.id)
                        set({ modifierGroupIds: next })
                      }}
                    />
                    <span>{g.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {g.selectionType} · {g.modifiers?.length || 0} options
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ButtonWithLoading
            loading={saving}
            onClick={handleSave}
            className="bg-orange-600 text-white hover:bg-orange-700"
          >
            {item.id ? 'Save changes' : 'Create item'}
          </ButtonWithLoading>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function CategoryEditor({
  category,
  onClose,
}: {
  category: any | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useState(() => {
    if (category) {
      setName(category.name)
      setDescription(category.description || '')
    }
  })

  // Sync when category changes
  if (category && category.name !== name && name === '') {
    setName(category.name)
    setDescription(category.description || '')
  }

  const handleSave = async () => {
    try {
      await api(`/api/admin/menu/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description }),
      })
      qc.invalidateQueries({ queryKey: ['admin-categories'] })
      toast.success('Category updated')
      onClose()
      setName('')
      setDescription('')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  const handleDelete = async () => {
    try {
      await api(`/api/admin/menu/categories/${category.id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey: ['admin-categories'] })
      toast.success('Category deleted')
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    }
  }

  return (
    <Dialog open={!!category} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="flex justify-between">
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} className="bg-orange-600 text-white hover:bg-orange-700">
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ImageUploader — supports drag/drop or click-to-browse file selection.
// Uploads the file to /api/admin/upload and stores the returned URL.
// Also accepts a manually-typed URL (e.g. external CDN) via the text input.
// ---------------------------------------------------------------------------

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB (matches /api/admin/upload)

function ImageUploader({
  value,
  onChange,
}: {
  value: string
  onChange: (url: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadFile = async (file: File) => {
    setLastError(null)
    // Normalise the MIME — some browsers send "image/jpg" instead of "image/jpeg"
    const fileMime = (file.type || '').toLowerCase().replace('image/jpg', 'image/jpeg')
    if (!ACCEPTED_IMAGE_TYPES.includes(fileMime)) {
      const msg = `Unsupported file type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP, GIF, or SVG.`
      setLastError(msg)
      toast.error(msg)
      return
    }
    if (file.size === 0) {
      const msg = 'File is empty.'
      setLastError(msg)
      toast.error(msg)
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      const msg = `File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      setLastError(msg)
      toast.error(msg)
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      // IMPORTANT: the field name MUST be "file" — the server reads form.get('file').
      formData.append('file', file, file.name)
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type manually — the browser sets it with the
        // correct multipart boundary automatically when we pass FormData.
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.data?.url) {
        const msg =
          json?.error ||
          `Upload failed (HTTP ${res.status} ${res.statusText})`
        throw new Error(msg)
      }
      onChange(json.data.url)
      toast.success('Image uploaded')
    } catch (err: any) {
      const msg = err.message || 'Upload failed'
      setLastError(msg)
      // Use a longer-lived error toast so the user can read the full message
      toast.error(msg, { duration: 6000 })
      console.error('[ImageUploader] upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    // Reset so the same file can be picked again later
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div className="space-y-2">
      {/* Preview / dropzone */}
      <div className="flex gap-3">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center transition-colors',
            dragOver
              ? 'border-orange-500 bg-orange-50'
              : value
              ? 'border-slate-200'
              : 'border-slate-300 hover:border-orange-400 hover:bg-orange-50/40',
          )}
        >
          {value ? (
            <img
              src={value}
              alt="Menu item preview"
              className="h-full w-full object-cover"
            />
          ) : uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
          ) : (
            <div className="flex flex-col items-center gap-1 p-2 text-xs text-muted-foreground">
              <Upload className="h-4 w-4" />
              <span>Click or drop</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        <div className="flex-1 space-y-1.5">
          <Input
            placeholder="Or paste image URL: https://…"
            value={value && /^https?:\/\//i.test(value) ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>PNG · JPEG · WebP · GIF · SVG</span>
            <span>•</span>
            <span>max 5 MB</span>
            {value && (
              <>
                <span>•</span>
                <button
                  type="button"
                  className="text-red-600 hover:underline"
                  onClick={() => onChange('')}
                >
                  Remove
                </button>
              </>
            )}
          </div>
          {value && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(value) && (
            <p className="text-xs text-emerald-700">
              ✓ Image uploaded successfully
            </p>
          )}
          {lastError && (
            <p className="text-xs text-red-600">
              ⚠ {lastError}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
