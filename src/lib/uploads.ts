/**
 * Upload storage location resolver — single source of truth for WHERE
 * uploaded files are written and WHERE they are later read from.
 *
 * Why this exists: the sandbox's overlay filesystem can flip read-only
 * (EROFS) at ANY moment — even mid-session. A directory that was writable
 * at startup may reject writes later. Earlier versions of this file only
 * had two candidates and no OS-temp fallback, so when the overlay flipped,
 * every write attempt hit the same dead directory and uploads failed with
 * "write failed: EROFS".
 *
 * Resolution order (first WRITABLE candidate wins):
 *   1. UPLOAD_DIR env var (if set) — lets production pin a persistent
 *      volume (EFS mount, Docker volume, etc.).
 *   2. /home/z/my-project/upload — the sandbox's persistent writable mount
 *      (survives overlay-FS read-only flips and container restarts).
 *   3. <cwd>/public/uploads — classic static location (local dev, Vercel).
 *   4. <os.tmpdir()>/take2-uploads — LAST-RESORT tmpfs. Almost never
 *      read-only; guarantees uploads still succeed even while the overlay
 *      is flipped (files here live until the container stops).
 *
 * Two guarantees that previous versions lacked:
 *   - WRITE side: getUploadDir() creates missing candidate dirs (mkdir -p)
 *     and PROOF-checks writability by actually writing a probe file —
 *     accessSync(W_OK) alone can pass on a directory that still refuses
 *     create/write at the filesystem level.
 *   - READ side: resolveStoredFile() searches EVERY candidate directory,
 *     so a file uploaded to location A stays downloadable even after the
 *     resolver later prefers location B. Previously the serving routes
 *     looked only in the currently-resolved dir → spurious 404s after a
 *     filesystem flip.
 *
 * Files stored outside /public are served by the catch-all route at
 * src/app/uploads/[...path]/route.ts (and the legacy /api/uploads/[name]
 * route) — both delegate lookup to resolveStoredFile(). Files inside
 * public/uploads are ALSO served statically by Next.js. Either way the
 * public URL is always /uploads/<filename>.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync, accessSync, constants } from 'fs'
import os from 'os'
import path from 'path'

/** Ordered candidate directories, highest priority first. */
export function getUploadDirCandidates(): string[] {
  const dirs: string[] = []
  if (process.env.UPLOAD_DIR) dirs.push(process.env.UPLOAD_DIR)
  dirs.push('/home/z/my-project/upload') // sandbox persistent mount
  dirs.push(path.join(process.cwd(), 'public', 'uploads')) // classic static
  dirs.push(path.join(os.tmpdir(), 'take2-uploads')) // last-resort tmpfs
  return dirs
}

/**
 * Returns the first candidate directory that is PROVABLY writable.
 * Creates missing dirs, probe-writes a canary file, and only gives up by
 * returning the OS-temp fallback (which the upload route still attempts,
 * surfacing a clear error if even /tmp refuses writes).
 *
 * Do NOT cache the result across requests — the overlay FS can flip
 * read-only at any moment, so every upload re-evaluates. The probe write
 * costs microseconds next to the image write that follows it.
 */
export function getUploadDir(): string {
  const candidates = getUploadDirCandidates()
  for (const dir of candidates) {
    if (ensureDirWritable(dir)) return dir
  }
  // Absolute last resort — return the tmp fallback even if the probe just
  // failed (the caller's own write attempt will surface a precise error).
  return candidates[candidates.length - 1]
}

/**
 * Finds an uploaded file across EVERY candidate directory (most recent
 * writes may live in a different dir than older ones). Returns the
 * absolute path, or null when the file exists nowhere.
 */
export function resolveStoredFile(filename: string): string | null {
  // Uploaded names are always sanitized to [a-zA-Z0-9.-] at write time.
  const safe = filename.replace(/[^a-zA-Z0-9.\-]/g, '')
  if (!safe || safe.startsWith('.')) return null
  for (const dir of getUploadDirCandidates()) {
    try {
      const full = path.join(dir, safe)
      if (existsSync(full)) return full
    } catch {
      // unreadable dir — keep searching the remaining candidates
    }
  }
  return null
}

/**
 * Creates `dir` if missing and proves it writable with a real probe write.
 * Returns false (never throws) when the dir cannot be used, so callers can
 * simply fall through to the next candidate.
 */
export function ensureDirWritable(dir: string): boolean {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch {
    return false // cannot create (e.g. parent read-only) → next candidate
  }
  // accessSync(W_OK) is a cheap first check…
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    return false
  }
  // …but only a real write proves the FS accepts new files right now
  // (overlay FS flips can defeat access-check semantics).
  const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** Legacy no-op kept for compatibility — resolution is re-checked per call. */
export function invalidateUploadDirCache(): void {}

/**
 * Maps a stored filename to the public URL the client should use. Always
 * returns /uploads/<name> regardless of which backing directory is used,
 * so the frontend never needs to know where files are physically stored.
 */
export function toPublicUrl(filename: string): string {
  return `/uploads/${filename.replace(/[^a-zA-Z0-9.\-]/g, '')}`
}
