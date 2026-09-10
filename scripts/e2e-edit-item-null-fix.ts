/**
 * E2E: edit menu item with NULL description / tags (image change scenario)
 *
 * Bug: the edit dialog round-trips the raw GET row. For items stored with a
 * NULL description/tags, PATCH /api/admin/menu/items/[id] 422'd with Zod v4
 * "Invalid input: expected string, received null" — blocking ALL edits,
 * including image changes.
 *
 * Verifies (as RESTAURANT_OWNER):
 *  1. Creating an item without description/tags → DB row with nulls (the broken state)
 *  2. PATCH with the raw row + a new image (exact UI flow) → 200
 *  3. PATCH with explicit nulls (direct API caller) → 200
 *  4. Image persisted; description stays nullable-null (no corruption)
 *  5. Normal string edits still work; cleanup of the test item
 *
 * Run: dev server on localhost:3000
 */
const BASE = 'http://localhost:3000'
const EMAIL = 'owner@spicegarden.in'
const PASSWORD = 'password123'

let pass = 0
let failCount = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    failCount++
    console.log(`  FAIL  ${name} ${extra}`)
  }
}

async function login(): Promise<string> {
  const r1 = await fetch(`${BASE}/api/auth/csrf`)
  const csrfJson = (await r1.json()) as { csrfToken: string }
  const setCookies1 = r1.headers.getSetCookie?.() || []
  const csrfCookie = setCookies1.map((c) => c.split(';')[0]).join('; ')
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie },
    body: new URLSearchParams({
      csrfToken: csrfJson.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: 'true',
    }),
    redirect: 'manual',
  })
  const setCookies2 = r2.headers.getSetCookie?.() || []
  const cookie = setCookies2
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session-token'))
    .join('; ')
  if (!cookie) throw new Error('Login failed — no session token')
  return cookie
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init?.headers || {}) },
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  const cookie = await login()
  check('owner login', !!cookie)

  // 1. Find a category to create the test item under
  const cats = await api(cookie, '/api/admin/menu/categories')
  check('categories list', cats.status === 200 && Array.isArray(cats.json.data) && cats.json.data.length > 0)
  const categoryId = cats.json.data[0].id

  // 2. Create item WITHOUT description/tags → DB nulls (the broken state)
  const created = await api(cookie, '/api/admin/menu/items', {
    method: 'POST',
    body: JSON.stringify({
      name: 'ZZZ-null-fix-e2e',
      categoryId,
      basePrice: 99,
    }),
  })
  check(
    'create item without description/tags',
    created.status === 200 || created.status === 201,
    JSON.stringify(created.json).slice(0, 200),
  )
  const itemId = created.json?.data?.id
  if (!itemId) {
    console.log('Cannot continue without a test item'); return
  }

  // 3. Fetch the raw row like the UI does
  const row = await api(cookie, `/api/admin/menu/items/${itemId}`)
  const raw = row.json?.data
  check('GET returns stored null description', raw?.description === null, `got: ${JSON.stringify(raw?.description)}`)
  check('GET returns stored null tags', raw?.tags === null, `got: ${JSON.stringify(raw?.tags)}`)

  // 4. THE BUG SCENARIO: PATCH the raw row + a changed image (exact UI flow)
  const patchedImage = `/uploads/e2e-null-fix-${Date.now()}.png`
  const r1 = await api(cookie, `/api/admin/menu/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...raw, image: patchedImage }),
  })
  check(
    'PATCH raw row (nulls) + new image → 200',
    r1.status === 200,
    `status=${r1.status} body=${JSON.stringify(r1.json).slice(0, 200)}`,
  )
  check('new image persisted', r1.json?.data?.image === patchedImage, `got: ${r1.json?.data?.image}`)

  // 5. PATCH with EXPLICIT nulls (direct API caller / older client)
  const r2 = await api(cookie, `/api/admin/menu/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: null, tags: null, image: patchedImage }),
  })
  check(
    'PATCH explicit null description/tags → 200',
    r2.status === 200,
    `status=${r2.status} body=${JSON.stringify(r2.json).slice(0, 200)}`,
  )

  // 6. Row state stays consistent (no data corruption from the round-trip)
  const after = await api(cookie, `/api/admin/menu/items/${itemId}`)
  check('image still persisted after second PATCH', after.json?.data?.image === patchedImage)
  check('description still null/empty (clean)', after.json?.data?.description == null || after.json?.data?.description === '')

  // 7. Normal string edits still work
  const r3 = await api(cookie, `/api/admin/menu/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: 'Now with a description', tags: 'e2e' }),
  })
  check('string description/tags still accepted', r3.status === 200)
  check('string description persisted', r3.json?.data?.description === 'Now with a description')

  // 8. Cleanup
  const del = await api(cookie, `/api/admin/menu/items/${itemId}`, { method: 'DELETE' })
  check('cleanup: test item deleted', del.status === 200)

  console.log(`\n${pass} passed, ${failCount} failed`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E crashed:', e)
  process.exit(1)
})
