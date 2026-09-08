import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { getUploadDir } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

// GET /uploads/<...path>
//
// Serves uploaded files that are stored OUTSIDE the /public folder (e.g. in
// the always-writable OSS mount at /home/z/my-project/upload). When a file
// DOES exist in public/uploads, Next.js serves it statically and this route
// is never hit. This route only fires for files that aren't in /public —
// i.e. the ones written to the OSS mount by /api/admin/upload.
//
// Security: rejects path traversal (..) and only serves files from the
// resolved upload directory. Sets a 1-year cache for immutable assets.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params

  // Build the filename from the path segments. Reject anything that tries
  // to escape the upload directory (path traversal).
  const filename = segments.map((s) => decodeURIComponent(s)).join('/')
  if (
    filename.includes('..') ||
    filename.startsWith('/') ||
    path.isAbsolute(filename)
  ) {
    return new NextResponse('Not found', { status: 404 })
  }

  const uploadDir = getUploadDir()
  const fullPath = path.join(uploadDir, filename)

  // Final safety: ensure the resolved path is still inside the upload dir.
  const rel = path.relative(uploadDir, fullPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return new NextResponse('Not found', { status: 404 })
  }

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
