import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { requirePermission, ok, fail } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

/**
 * POST /api/admin/upload
 *
 * Accepts a multipart/form-data upload with a single `file` field (image),
 * saves it to /public/uploads/<unique-name>, and returns the served URL.
 *
 * Used by:
 *   - admin/settings-manager (restaurant logo upload)
 *   - admin/menu-manager (menu item image upload)
 *
 * The file is stored on the local filesystem under public/uploads/ so Next.js
 * serves it directly at /uploads/<name>. In production you'd swap this for an
 * S3 / cloud-storage upload, but the URL contract ({ data: { url } }) stays
 * the same so the frontend doesn't change.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requirePermission('settings.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return fail('Invalid multipart body. Expected a file upload.', 400)
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return fail('Missing "file" field in form data.', 400)
  }

  // Validate MIME + size
  const fileMime = (file.type || '').toLowerCase().replace('image/jpg', 'image/jpeg')
  if (!ACCEPTED_IMAGE_TYPES.includes(fileMime)) {
    return fail(
      `Unsupported file type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP, GIF, or SVG.`,
      415,
    )
  }
  if (file.size === 0) return fail('File is empty.', 400)
  if (file.size > MAX_FILE_SIZE) {
    return fail(
      `File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
      413,
    )
  }

  // Build a unique, filesystem-safe filename: <timestamp>-<random>.<ext>
  const ext = fileMime.split('/')[1] || 'bin'
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const safeName = unique.replace(/[^a-zA-Z0-9.\-]/g, '')

  // Ensure the uploads directory exists (idempotent)
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const fullPath = path.join(UPLOAD_DIR, safeName)
  await writeFile(fullPath, buffer)

  // Public URL — served by Next.js from the /public folder
  const url = `/uploads/${safeName}`

  return ok({ url, filename: safeName, size: file.size, type: fileMime })
}
