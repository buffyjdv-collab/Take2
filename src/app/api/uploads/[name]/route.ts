import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/[name]
 *
 * Serves an uploaded file from the writable uploads directory.
 *
 * The uploads directory is resolved in this priority order:
 *   1. process.env.UPLOADS_DIR (explicit override)
 *   2. <project>/upload        — a persistent writable tmpfs mount in the
 *                                sandbox (survives overlay-FS read-only flips)
 *   3. <project>/public/uploads — fallback (Next.js serves this directly, but
 *                                it can flip read-only in the sandbox)
 *
 * The route streams the file bytes with the correct Content-Type and a long
 * cache max-age (immutable — uploaded files are content-addressed by unique
 * timestamped names, so they never change once written).
 */
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bin: 'application/octet-stream',
}

function resolveUploadsDir(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR
  const projectRoot = process.cwd()
  // Prefer the persistent tmpfs mount under <project>/upload (writable even
  // when the overlay FS flips read-only).
  const tmpfs = path.join(projectRoot, 'upload')
  if (existsSync(tmpfs)) return tmpfs
  // Fallback to public/uploads (served directly by Next.js otherwise).
  return path.join(projectRoot, 'public', 'uploads')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params

  // Strict filename validation — only allow [a-zA-Z0-9.\-] to prevent path
  // traversal (../etc/passwd etc.). The upload route generates names matching
  // this pattern, so legitimate files always pass.
  if (!name || !/^[a-zA-Z0-9.\-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid filename.' }, { status: 400 })
  }

  const uploadsDir = resolveUploadsDir()
  const fullPath = path.join(uploadsDir, name)

  // Re-verify the resolved path is still inside uploadsDir (defence-in-depth
  // against any edge-case path tricks).
  const normalized = path.normalize(fullPath)
  if (!normalized.startsWith(path.normalize(uploadsDir) + path.sep) && normalized !== path.normalize(uploadsDir)) {
    return NextResponse.json({ error: 'Invalid path.' }, { status: 400 })
  }

  try {
    await stat(fullPath)
  } catch {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 })
  }

  try {
    const buffer = await readFile(fullPath)
    const ext = name.split('.').pop()?.toLowerCase() || 'bin'
    const mime = EXT_TO_MIME[ext] || 'application/octet-stream'
    // Immutable cache: uploaded files have unique timestamped names and never
    // change once written, so the browser can cache them for a long time.
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(buffer.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Could not read file.' }, { status: 500 })
  }
}
