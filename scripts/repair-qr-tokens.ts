/**
 * One-time repair of QR table tokens that are not URL-safe.
 *
 * Tokens are embedded in scan URLs (/t/<token>). Tokens built from raw table
 * numbers ("Medchal 01" -> "t-medchal 01-…") contain spaces, which phone
 * camera scanners mangle (truncate / re-encode) — customers saw
 * "QR code not recognised". This script regenerates every unsafe token as
 * t-<slug>-<random> using the same shape the app now creates on its own.
 *
 * ⚠ Old printed QRs stop working after this — re-print from Tables & QR page.
 * Run with --dry to preview. Idempotent.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const dry = process.argv.includes('--dry')

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'tbl'
}

function generateToken(prefix: string, length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}-${s}`
}

async function main() {
  const tables = await db.table.findMany({
    select: { id: true, number: true, branchId: true, qrCodeToken: true },
    orderBy: { number: 'asc' },
  })
  const unsafe = tables.filter((t) => !/^[a-z0-9-]+$/.test(t.qrCodeToken))
  console.log(`=== QR TOKEN REPAIR ${dry ? '(DRY RUN)' : ''}: ${unsafe.length} unsafe of ${tables.length} tokens ===`)
  for (const t of unsafe) {
    const newToken = generateToken(`t-${slugify(t.number)}`)
    console.log(`table "${t.number}" (branch=${t.branchId ?? 'none'})\n  old: ${t.qrCodeToken}\n  new: ${newToken}`)
    if (!dry) {
      await db.table.update({ where: { id: t.id }, data: { qrCodeToken: newToken } })
    }
  }
  if (!dry && unsafe.length > 0) {
    console.log('\nDone. Old printed QR codes for these tables are now invalid — re-print them from Tables & QR.')
  }
}

main().finally(() => db.$disconnect())
