/**
 * URL-safe helpers for table QR tokens.
 *
 * QR tokens are embedded inside scan URLs (/t/<token>) that customer phones
 * open from their camera app. They therefore MUST contain only [a-z0-9-] —
 * characters like spaces break scanner→browser handoffs (URLs get truncated
 * at the space or re-encoded), which surfaced as "QR code not recognised"
 * for tables named e.g. "Medchal 01".
 */

/**
 * Turn any table number / label into a URL-safe slug for the token prefix.
 * "Medchal 01" → "medchal-01", "T1/2" → "t1-2", "🍺 5" → "5" (or "tbl").
 */
export function slugifyTokenPrefix(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // runs of spaces / special chars → single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
  return slug || 'tbl'
}

/**
 * Candidate spellings of a scanned token. Some phone cameras and QR handoffs
 * re-encode spaces as "+", or double-encode "%20" → "%2520". Trying these
 * variants lets legacy printed QRs keep working after the DB is repaired.
 */
export function tableTokenVariants(token: string): string[] {
  const variants = [token]
  const plusAsSpace = token.replace(/\+/g, ' ')
  if (plusAsSpace !== token) variants.push(plusAsSpace)
  try {
    const once = decodeURIComponent(token)
    if (once !== token) variants.push(once)
  } catch {
    // malformed percent-encoding — nothing more to try
  }
  return variants
}
