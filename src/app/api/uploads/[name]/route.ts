import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { resolveStoredFile } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/[name]
 *
 * Legacy serving route — kept so older logo/image URLs keep working.
 * Delegates lookup to resolveStoredFile(), which searches EVERY candidate
 * upload directory (env UPLOAD_DIR → persistent mount → public/uploads →
 * OS temp), so files remain downloadable even when the write-time directory
 * differs from the currently-preferred one (e.g. after an overlay-FS
 * read-only flip).
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

  // Search every candidate upload directory for this file.
  const storedPath = resolveStoredFile(name)
  if (!storedPath) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 })
  }
  const fullPath = storedPath

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
