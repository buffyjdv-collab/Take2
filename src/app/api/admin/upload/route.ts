import { NextRequest } from 'next/server'
import crypto from 'crypto'
import {
  requireAuth,
  ok,
  fail,
  writeAudit,
  forbidden,
} from '@/lib/api-helpers'
import { hasPermissionAsync } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST /api/admin/upload
// Accepts either:
//   - multipart/form-data with a `file` field (recommended for large images)
//   - JSON body: { "dataUrl": "data:image/png;base64,..." }  (for tiny uploads / data URLs)
//
// Returns: { "url": "data:image/<type>;base64,..." }
//
// Images are stored as base64 data URLs directly in the database (MenuItem.image).
// This works in ALL deployment environments — local dev, Vercel, Docker, serverless —
// without requiring a writable filesystem.
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB (raised from 2 MB — phone photos are often larger)
const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]

export async function POST(req: NextRequest) {
  // Anyone who can create OR update a menu item may upload an image for it.
  // We deliberately use a permissive OR here so that managers (who typically
  // have MENU_ITEM.UPDATE but maybe not MENU_ITEM.CREATE in some RBAC configs)
  // can still upload images when editing items.
  const user = await requireAuth()
  if (!user) return fail('Unauthorized', 401)
  const canCreate = await hasPermissionAsync(user.role as string, 'MENU_ITEM.CREATE')
  const canUpdate = await hasPermissionAsync(user.role as string, 'MENU_ITEM.UPDATE')
  if (!canCreate && !canUpdate) {
    return forbidden('You do not have permission to upload menu images.')
  }

  const contentType = req.headers.get('content-type') || ''

  let buffer: Buffer
  let mime: string
  let originalName: string | null = null

  try {
    if (contentType.startsWith('multipart/form-data')) {
      // IMPORTANT: req.formData() can only be called ONCE on a NextRequest.
      // We read it eagerly here and extract the file.
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return fail(
          'Missing "file" field in form data. Make sure you are sending a File object (not a string) under the key "file".',
          400,
        )
      }
      if (file.size === 0) {
        return fail('Uploaded file is empty.', 400)
      }
      if (file.size > MAX_BYTES) {
        return fail(
          `File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max ${MAX_BYTES / 1024 / 1024}MB.`,
          413,
        )
      }
      // Some browsers send image/jpg instead of image/jpeg — normalise.
      mime = (file.type || 'image/png').toLowerCase().replace('image/jpg', 'image/jpeg')
      if (!ALLOWED_MIME.includes(mime)) {
        return fail(
          `Unsupported file type: ${mime}. Allowed: PNG, JPEG, WebP, GIF, SVG.`,
          415,
        )
      }
      originalName = file.name || null
      const ab = await file.arrayBuffer()
      buffer = Buffer.from(ab)
    } else if (contentType.includes('application/json')) {
      const body = await req.json()
      const dataUrl: string | undefined = body?.dataUrl
      if (!dataUrl) {
        return fail('Missing "dataUrl" in JSON body.', 400)
      }
      const match = dataUrl.match(
        /^data:(image\/(png|jpe?g|webp|gif|svg\+xml));base64,(.+)$/i,
      )
      if (!match) {
        return fail(
          'Invalid data URL. Expected format: data:image/<type>;base64,<data>',
          400,
        )
      }
      mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
      if (!ALLOWED_MIME.includes(mime)) {
        return fail(`Unsupported image type: ${mime}`, 415)
      }
      const base64 = match[3]
      buffer = Buffer.from(base64, 'base64')
      if (buffer.length > MAX_BYTES) {
        return fail(
          `Decoded image too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB). Max ${MAX_BYTES / 1024 / 1024}MB.`,
          413,
        )
      }
    } else {
      return fail(
        `Unsupported Content-Type: "${contentType}". Use multipart/form-data (with a "file" field) or application/json (with a "dataUrl" field).`,
        415,
      )
    }
  } catch (err: any) {
    console.error('[upload] parse error:', err)
    return fail(
      `Failed to parse upload: ${err.message || err}. If you're sending multipart/form-data, make sure the field name is exactly "file".`,
      400,
    )
  }

  // Sanity check — buffer must be non-empty and start with a recognised image magic byte
  if (!buffer || buffer.length < 8) {
    return fail('Uploaded file appears to be empty or corrupted.', 400)
  }

  // Return a base64 data URL — no filesystem writes needed.
  // This works in all deployment environments (Vercel, Docker, serverless, local).
  const url = `data:${mime};base64,${buffer.toString('base64')}`
  const filename = `upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`

  writeAudit(user, 'CREATE', 'UPLOAD', null, {
    url: `[data URL ${mime} ${buffer.length} bytes]`,
    mime,
    bytes: buffer.length,
    originalName,
  })

  return ok({ url, mime, bytes: buffer.length, filename }, 201)
}
