import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { tableTokenVariants } from '@/lib/tokens'
import { CustomerApp } from '@/components/customer/customer-app'

/**
 * Public QR scan route — /t/<tableToken>
 *
 * This is the URL encoded inside every table QR code. When a customer scans
 * the QR with their phone camera, this route opens automatically and the
 * menu loads instantly (no login, no extra taps). The table token provides
 * tenant scoping, exactly like the legacy `/?table=<token>` entry point.
 */

interface ScanPageProps {
  params: Promise<{ token: string }>
}

// Resolve the table once — the result is reused by both generateMetadata
// and the page render so a scan costs a single indexed query. Some phone
// cameras re-encode scanned URLs (space → +, %20 → %2520), so a few token
// spellings are tried before giving up — keeps legacy printed QRs scannable.
async function resolveTable(token: string) {
  try {
    for (const candidate of tableTokenVariants(token)) {
      const table = await db.table.findUnique({
        where: { qrCodeToken: candidate },
        select: {
          id: true,
          number: true,
          label: true,
          active: true,
          restaurant: {
            select: { name: true, tagline: true, primaryColor: true },
          },
        },
      })
      if (table) return table
    }
    return null
  } catch (err) {
    console.warn('[/t] table lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// Brand the phone browser tab with the restaurant name the moment the QR
// URL opens — the customer sees "Spice Garden — Menu", not a raw URL.
export async function generateMetadata({ params }: ScanPageProps): Promise<Metadata> {
  const { token } = await params
  const table = await resolveTable(token)
  const name = table?.restaurant?.name

  return {
    title: name ? `${name} — Menu` : 'Restaurant menu',
    description: name
      ? `Scan-to-order digital menu for ${name}${table?.number ? ` · Table ${table.number}` : ''}.`
      : 'Scan-to-order digital restaurant menu.',
    robots: { index: false, follow: false },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function ScanPage({ params }: ScanPageProps) {
  const { token } = await params

  const table = await resolveTable(token)
  if (!table) notFound()

  // CustomerApp fetches /api/customer/menu?table=<token> on mount and
  // handles every state itself: loading, closed restaurant, blocked QR,
  // and order tracking. Scanning the QR therefore "just opens" the menu.
  return <CustomerApp token={token} />
}
