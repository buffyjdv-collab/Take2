'use client'

/**
 * ImageUploader — shared drag/drop + click-to-browse file uploader.
 *
 * Uploads the selected image to /api/admin/upload and calls onChange() with
 * the returned URL. Also accepts a manually-typed URL (e.g. external CDN)
 * via the text input below the dropzone.
 *
 * Used by:
 *   - admin/settings-manager (restaurant logo)
 *   - admin/menu-manager (menu item images)
 *
 * Contract with /api/admin/upload:
 *   POST multipart/form-data with field name "file"
 *   → { success, data: { url } }
 */
import { useRef, useState } from 'react'
import { Upload, Loader2, X, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB (matches /api/admin/upload)

export function ImageUploader({
  value,
  onChange,
  /** Shape of the preview — "round" for logos/avatars, "card" for menu items. */
  shape = 'card',
  label = 'Image',
  /** Optional hint shown under the dropzone. */
  hint,
}: {
  value: string
  onChange: (url: string) => void
  shape?: 'round' | 'card'
  label?: string
  hint?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadFile = async (file: File) => {
    const fileMime = (file.type || '').toLowerCase().replace('image/jpg', 'image/jpeg')
    if (!ACCEPTED_IMAGE_TYPES.includes(fileMime)) {
      const msg = `Unsupported file type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP, GIF, or SVG.`
      toast.error(msg)
      return
    }
    if (file.size === 0) {
      toast.error('File is empty.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      const msg = `File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      toast.error(msg)
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.data?.url) {
        const msg = json?.error || `Upload failed (HTTP ${res.status} ${res.statusText})`
        toast.error(msg)
        return
      }
      onChange(json.data.url)
      toast.success(`${label} uploaded`)
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    // Reset so the same file can be selected again
    e.target.value = ''
  }

  const isRound = shape === 'round'

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {/* Dropzone / preview */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'group relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed transition-colors',
            isRound ? 'h-16 w-16 rounded-full' : 'h-20 w-20 rounded-xl',
            dragOver
              ? 'border-orange-400 bg-orange-50'
              : 'border-slate-300 bg-slate-50 hover:border-orange-300 hover:bg-orange-50/40',
          )}
        >
          {value ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt={label}
                className={cn(
                  'h-full w-full object-cover',
                  isRound && 'rounded-full',
                )}
              />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}
            </>
          ) : uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          ) : (
            <Upload className="h-5 w-5 text-slate-400 transition-colors group-hover:text-orange-500" />
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Link2 className="h-3 w-3 shrink-0 text-slate-400" />
            <input
              type="url"
              placeholder="…or paste an image URL"
              value={value.startsWith('/uploads/') ? '' : value}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs text-slate-700 focus:border-orange-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {hint && (
        <p className="text-[11px] text-slate-400">
          {hint}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        onChange={handleSelect}
        className="hidden"
      />
    </div>
  )
}
