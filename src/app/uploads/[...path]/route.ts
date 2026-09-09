import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { resolveStoredFile } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

// GET /uploads/<...path>
//
// Serves uploaded files that are stored OUTSIDE the /public folder (e.g. in
// the persistent writable mount). When a file DOES exist in public/uploads,
// Next.js serves it statically and this route is never hit.
//
// Lookup goes through resolveStoredFile(), which searches EVERY candidate
// upload directory (env UPLOAD_DIR → persistent mount → public/uploads →
// OS temp). This matters because the write-time directory can differ from
// the currently-preferred one after the overlay filesystem flips read-only —
// resolving via a single "current" dir caused spurious 404s for files that
// were in fact safely stored elsewhere.
//
// Security: rejects path traversal (..) and only serves files whose names
// match the sanitized upload pattern.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params

  // Build the filename from the path segments and validate it up-front.
  // Uploaded names are always sanitized to [a-zA-Z0-9.-]; anything else
  // (including traversal attempts) is rejected before touching the disk.
  const filename = segments.map((s) => decodeURIComponent(s)).join('/')
  const safeName = filename.replace(/[^a-zA-Z0-9.\-]/g, '')
  if (
    !safeName ||
    safeName !== filename ||
    filename.includes('..') ||
    filename.startsWith('/') ||
    path.isAbsolute(filename)
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Search every candidate upload directory for this file.
  const storedPath = resolveStoredFile(safeName)
  if (!storedPath) {
    return new NextResponse('Not found', { status: 404 })
  }
  const fullPath = storedPath

  let bytes: Buffer
  try {
    bytes = await readFile(fullPath)
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  // Infer the content type from the extension.
  const ext = path.extname(filename).toLowerCase().slice(1)
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'application/octet-stream'

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
