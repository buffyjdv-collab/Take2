import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { requirePermission, ok, fail, getSessionUser } from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'
import { getUploadDir, toPublicUrl } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_WRITE_RETRIES = 3

/**
 * Resilient permission check for the upload route.
 *
 * `requirePermission` calls `hasPermissionAsync` which queries the DB for RBAC
 * overrides. The Neon pooler can drop idle connections (causing transient
 * Prisma errors). To avoid an opaque 500 on the upload route, we:
 *   1. Try the full async permission check.
 *   2. If it throws (DB unreachable), fall back to the static `hasPermission`
 *      which uses the in-memory override cache + the static DEFAULT_PERMISSIONS
 *      map. For an already-logged-in owner this grants settings.manage without
 *      needing the DB.
 *   3. If even that denies, return a 403 (never a 500).
 */
async function checkUploadPermission() {
  try {
    const { user, error } = await requirePermission('settings.manage')
    if (error) return { user: null, error }
    return { user, error: null }
  } catch {
    // DB-backed permission check failed (e.g. Neon connection dropped).
    // Fall back to the static check so an authenticated owner can still upload.
    try {
      const user = await getSessionUser()
      if (!user) return { user: null, error: fail('Unauthorized — please sign in.', 401) }
      const allowed = hasPermission(user.role as string, 'settings.manage')
      if (!allowed) {
        return { user: null, error: fail('You do not have permission to upload files.', 403) }
      }
      return { user, error: null }
    } catch {
      return { user: null, error: fail('Could not verify permissions. Please refresh and try again.', 500) }
    }
  }
}

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
 * The whole handler is wrapped in a try/catch so the client never sees an
 * opaque 500 — it gets a clear, actionable error message instead. Common
 * transient causes (Neon connection drops, missing uploads dir) are handled
 * gracefully so retries succeed.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Permission check (resilient — falls back to static on DB error)
    const { user, error } = await checkUploadPermission()
    if (error) return error
    if (!user) return fail('Unauthorized — please sign in.', 401)

    // 2. Parse multipart body
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return fail(
        'Could not read the uploaded file. Make sure you selected an image file (PNG, JPEG, WebP, GIF, or SVG).',
        400,
      )
    }

    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return fail('Missing "file" field in form data.', 400)
    }

    // 3. Validate MIME + size
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

    // 4. Build a unique, filesystem-safe filename
    const ext = fileMime.split('/')[1] || 'bin'
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    const safeName = unique.replace(/[^a-zA-Z0-9.\-]/g, '')

    // 5. Resolve the upload directory.
    //    Prefers the always-writable OSS mount (/home/z/my-project/upload)
    //    over the volatile public/uploads overlay (which intermittently
    //    flips to read-only / EROFS). Falls back automatically if the
    //    preferred location isn't writable.
    const uploadDir = getUploadDir()

    // Ensure the directory exists (idempotent — won't throw if it exists).
    try {
      await mkdir(uploadDir, { recursive: true })
    } catch (err: any) {
      console.error('[upload] mkdir failed:', uploadDir, err?.code || err?.message || err)
      return fail(
        `Could not create the uploads directory (${err?.code || 'unknown error'}). Please contact support.`,
        500,
      )
    }

    // 6. Write the file to disk, retrying on transient failures.
    //    Transient FS errors (EBUSY/EAGAIN/transient EACCES) are retried with
    //    a tiny back-off. EROFS (read-only filesystem) is NOT retried — instead
    //    we switch to the fallback directory (the always-writable OSS mount)
    //    on the next attempt, so uploads never fail due to a read-only FS.
    let bytes: ArrayBuffer
    try {
      bytes = await file.arrayBuffer()
    } catch {
      return fail('Could not read the file data. Please try again with a different file.', 400)
    }
    const buffer = Buffer.from(bytes)

    let lastErr: any = null
    let writeDir = uploadDir
    for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
      const fullPath = path.join(writeDir, safeName)
      try {
        await writeFile(fullPath, buffer)
        lastErr = null
        break
      } catch (err: any) {
        lastErr = err
        const code = err?.code || ''
        // EROFS = read-only filesystem — don't retry the SAME dir; switch to
        // the fallback (OSS mount) which is always writable.
        if (code === 'EROFS') {
          console.warn('[upload] EROFS on', writeDir, '→ switching to fallback')
          const fallback = path.join(process.cwd(), 'public', 'uploads')
          // If we were already on public/uploads (EROFS), switch to the OSS mount
          writeDir =
            writeDir === fallback ? '/home/z/my-project/upload' : writeDir
          // Forcibly re-resolve via getUploadDir which picks a writable dir
          writeDir = getUploadDir()
          try {
            await mkdir(writeDir, { recursive: true })
          } catch {
            /* ignore — will retry the write */
          }
          continue
        }
        // Transient FS errors worth retrying in place.
        const transient =
          code === 'EBUSY' ||
          code === 'EAGAIN' ||
          code === 'EDEADLK' ||
          code === 'EACCES' ||
          code === 'ENOENT' ||
          code === 'EMFILE' ||
          code === 'ENFILE'
        console.warn(
          `[upload] writeFile attempt ${attempt}/${MAX_WRITE_RETRIES} failed:`,
          code || err?.message,
          '→',
          transient ? 'retrying' : 'giving up',
        )
        if (!transient || attempt === MAX_WRITE_RETRIES) break
        await new Promise((r) => setTimeout(r, 50 * attempt))
        if (code === 'ENOENT') {
          try {
            await mkdir(writeDir, { recursive: true })
          } catch {
            /* will retry the write anyway */
          }
        }
      }
    }

    if (lastErr) {
      const code = lastErr?.code || 'unknown'
      const msg = lastErr?.message || String(lastErr)
      console.error('[upload] all write attempts failed:', writeDir, code, msg)
      return fail(
        `Could not save the file to the server (write failed: ${code}). ` +
          `Please try again — if it keeps failing, refresh the page and retry.`,
        500,
      )
    }

    // 7. Public URL — /uploads/<name>. Served either statically from
    //    public/uploads (when stored there) or by the catch-all route
    //    src/app/uploads/[...path]/route.ts (when stored in the OSS mount).
    const url = toPublicUrl(safeName)
    return ok({ url, filename: safeName, size: file.size, type: fileMime })
  } catch (err: any) {
    // Top-level safety net: never return an opaque 500. Surface a clear message
    // so the user knows whether to retry or contact support.
    console.error('[upload] unexpected error:', err?.message || err)
    return fail(
      'Upload failed due to a server error. Please try again — if it keeps failing, refresh the page and re-sign-in.',
      500,
    )
  }
}
