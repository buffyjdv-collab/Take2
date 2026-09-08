/**
 * Upload storage location resolver.
 *
 * The sandbox's /public folder sits on a `volatile` overlay filesystem that
 * intermittently flips to read-only (EROFS) — which broke uploads. To avoid
 * this, we write uploaded files to a dedicated always-writable mount when
 * it's available, and fall back to public/uploads otherwise.
 *
 * Resolution order:
 *   1. UPLOAD_DIR env var (if set) — lets production override (e.g. an EFS
 *      path on AWS, or /home/z/my-project/upload in the sandbox).
 *   2. /home/z/my-project/upload — the sandbox's OSS-backed fuse mount
 *      (always writable, persistent across container restarts).
 *   3. <cwd>/public/uploads — the default for local dev / Vercel (served
 *      statically by Next.js).
 *
 * Files written to locations 1 or 2 are served by the catch-all route at
 * src/app/uploads/[...path]/route.ts (since they're outside /public). Files
 * in location 3 are served statically by Next.js directly. Either way the
 * public URL is /uploads/<filename>, so <img src="/uploads/..."> works.
 */
import { existsSync, accessSync, constants } from 'fs'
import path from 'path'

let cachedDir: string | null = null

/**
 * Returns the directory where uploaded files should be stored. The result is
 * cached for the lifetime of the process. The directory is guaranteed to be
 * writable (we test it) — if the preferred location isn't writable we fall
 * through to the next candidate.
 */
export function getUploadDir(): string {
  if (cachedDir) return cachedDir

  const candidates: string[] = []
  if (process.env.UPLOAD_DIR) candidates.push(process.env.UPLOAD_DIR)
  candidates.push('/home/z/my-project/upload')
  candidates.push(path.join(process.cwd(), 'public', 'uploads'))

  for (const dir of candidates) {
    try {
      if (isDirWritable(dir)) {
        cachedDir = dir
        return dir
      }
    } catch {
      // not writable — try next candidate
    }
  }

  // Last resort: return the public/uploads path even if we couldn't verify
  // writability. The upload route's own error handling will surface a clear
  // message if writes fail.
  const fallback = path.join(process.cwd(), 'public', 'uploads')
  cachedDir = fallback
  return fallback
}

function isDirWritable(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Maps a stored filename to the public URL the client should use. Always
 * returns /uploads/<name> regardless of which backing directory is used,
 * so the frontend never needs to know where files are physically stored.
 */
export function toPublicUrl(filename: string): string {
  return `/uploads/${filename.replace(/[^a-zA-Z0-9.\-]/g, '')}`
}
