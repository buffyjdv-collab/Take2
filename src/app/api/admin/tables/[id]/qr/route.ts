import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import {
  requirePermission,
  ok,
  fail,
  scopeRestaurantId,
  writeAudit,
  generateToken,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

function publicBaseURL(req: NextRequest): string {
  // 1) Explicit public URL configured via env — the most reliable choice for
  //    printed QR codes. It stays correct no matter how the admin browses in
  //    (localhost, LAN IP, tunnel), so customer phones can always open it.
  //    Set NEXT_PUBLIC_APP_URL (or APP_URL) to e.g. https://menu.myrestaurant.com
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL
  if (configured && configured.startsWith('http')) {
    return configured.replace(/\/+$/, '')
  }

  // 2) Fall back to the request's public host (proxy-aware).
  const proto =
    req.headers.get('x-forwarded-proto') ||
    (req.nextUrl.protocol as string).replace(':', '') ||
    'https'
  const host =
    req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost'
  return `${proto}://${host}`
}

// Build the auto-open scan URL for a table's QR token. Encodes the short
// canonical route /t/<token> — short URLs keep the QR density low, which
// makes codes scan faster and more reliably from a phone camera.
function scanURL(req: NextRequest, token: string): string {
  return `${publicBaseURL(req)}/t/${encodeURIComponent(token)}`
}

// GET /api/admin/tables/[id]/qr  -> returns QR PNG (image/png) by default,
// or JSON with data-url when ?format=dataurl
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('dashboard.view')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const table = await db.table.findUnique({ where: { id } })
  if (!table) return fail('Table not found.', 404)
  if (restaurantId && table.restaurantId !== restaurantId) {
    return fail('Table not found.', 404)
  }

  const format = req.nextUrl.searchParams.get('format') || 'png'
  const url = scanURL(req, table.qrCodeToken)

  if (format === 'dataurl') {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 512,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
    return ok({ url, dataUrl, token: table.qrCodeToken })
  }

  if (format === 'json') {
    return ok({ url, token: table.qrCodeToken })
  }

  const png = await QRCode.toBuffer(url, {
    width: 512,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  })
  return new NextResponse(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="qr-${encodeURIComponent(table.number)}.png"`,
    },
  })
}

// POST /api/admin/tables/[id]/qr  -> regenerate token (invalidates old QR)
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requirePermission('tables.manage')
  if (error) return error
  if (!user) return fail('Unauthorized', 401)
  const { id } = await ctx.params
  const restaurantId = scopeRestaurantId(user, req.nextUrl.searchParams.get('restaurantId'))
  const table = await db.table.findUnique({ where: { id } })
  if (!table) return fail('Table not found.', 404)
  if (restaurantId && table.restaurantId !== restaurantId) {
    return fail('Table not found.', 404)
  }

  const newToken = generateToken(`t-${table.number.toLowerCase()}`)
  const updated = await db.table.update({
    where: { id },
    data: { qrCodeToken: newToken },
  })
  writeAudit(user, 'UPDATE', 'TABLE', id, { regeneratedQR: true })
  return ok({
    token: newToken,
    url: scanURL(req, newToken),
  })
}
