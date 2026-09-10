/**
 * E2E: restaurant owner can filter / show / hide ORDERS and TABLE QR CODES
 * branch-wise.
 *
 * Protocol (same as menu Task 13): owners & super admins pass ?branchId= —
 *   ?branchId=<id>  → exactly that branch
 *   ?branchId=none  → branchless (branchId null)
 *   ?branchId=all   → everything (default, backward compatible)
 * Branch-scoped staff (manager/waiter/…) have the param IGNORED — the server
 * always forces their own branch.
 *
 * Creates its own fixtures (2nd branch + branchless table + orders) via
 * Prisma so the checks are meaningful on any database, then cleans up.
 *
 * Run: dev server on localhost:3000
 */
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()
const MARK = 'ZZZFILT'
const BRANCH_NAME = `${MARK} Branch`

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

async function login(email: string, password: string): Promise<string> {
  const r1 = await fetch(`${BASE}/api/auth/csrf`)
  const csrfJson = (await r1.json()) as { csrfToken: string }
  const csrfCookie = (r1.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ')
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken: csrfJson.csrfToken, email, password, json: 'true' }),
    redirect: 'manual',
  })
  const cookie = (r2.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session-token'))
    .join('; ')
  if (!cookie) throw new Error(`Login failed for ${email}`)
  return cookie
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init?.headers || {}) },
  })
  const raw = await res.json().catch(() => ({}))
  // The API wraps payloads as { success, data } — unwrap like the client hook does.
  const json = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw
  return { status: res.status, json }
}

async function setupFixtures() {
  const owner = await db.user.findUnique({ where: { email: 'owner@spicegarden.in' } })
  if (!owner?.restaurantId) throw new Error('owner@spicegarden.in / restaurant not found')
  const restaurantId = owner.restaurantId

  // Clean any leftovers from a crashed previous run
  await cleanupFixtures(restaurantId)

  const branch = await db.branch.create({
    data: {
      restaurantId,
      name: BRANCH_NAME,
      address: 'E2E Filter Test Lane',
      phone: '+91 90000 00000',
      active: true,
    },
  })
  const branchTable = await db.table.create({
    data: {
      restaurantId,
      branchId: branch.id,
      number: `${MARK}-B1`,
      capacity: 4,
      active: true,
      qrCodeToken: `t-${MARK.toLowerCase()}-b1-${Math.random().toString(36).slice(2, 8)}`,
    },
  })
  const branchlessTable = await db.table.create({
    data: {
      restaurantId,
      branchId: null,
      number: `${MARK}-N1`,
      capacity: 2,
      active: true,
      qrCodeToken: `t-${MARK.toLowerCase()}-n1-${Math.random().toString(36).slice(2, 8)}`,
    },
  })
  const suffix = Date.now().toString(36)
  const branchOrder = await db.order.create({
    data: {
      orderNumber: `${MARK}-O1-${suffix}`,
      restaurantId,
      branchId: branch.id,
      tableId: branchTable.id,
      status: 'SERVED',
      paymentStatus: 'PAID',
    },
  })
  const branchlessOrder = await db.order.create({
    data: {
      orderNumber: `${MARK}-O2-${suffix}`,
      restaurantId,
      branchId: null,
      tableId: branchlessTable.id,
      status: 'SERVED',
      paymentStatus: 'PAID',
    },
  })
  return { restaurantId, branch, branchTable, branchlessTable, branchOrder, branchlessOrder }
}

async function cleanupFixtures(restaurantId: string) {
  const branch = await db.branch.findFirst({ where: { restaurantId, name: BRANCH_NAME } })
  await db.order.deleteMany({ where: { restaurantId, orderNumber: { startsWith: `${MARK}-` } } })
  await db.table.deleteMany({ where: { restaurantId, number: { startsWith: `${MARK}-` } } })
  if (branch) await db.branch.delete({ where: { id: branch.id } })
}

async function main() {
  const fx = await setupFixtures()
  const { branch, branchTable, branchlessTable, branchOrder, branchlessOrder } = fx
  try {
    // -------------------------------------------------------------- owner
    const owner = await login('owner@spicegarden.in', 'password123')
    check('owner login', !!owner)

    const br = await api(owner, '/api/admin/branches')
    const branches: any[] = br.json?.branches || []
    check(
      'owner branch list includes test branch',
      br.status === 200 && branches.some((b) => b.id === branch.id),
      `got ${branches.length} branches`,
    )

    // -------------------------------------------------------------- tables
    const allTables = await api(owner, '/api/admin/tables')
    const tables: any[] = allTables.json || []
    check('tables list loads', allTables.status === 200 && Array.isArray(tables), `status=${allTables.status}`)

    const fBranch = await api(owner, `/api/admin/tables?branchId=${branch.id}`)
    const fBranchRows: any[] = fBranch.json || []
    check(
      'tables ?branchId=<test branch> → exactly the fixture table',
      fBranch.status === 200 &&
        fBranchRows.some((t) => t.id === branchTable.id) &&
        fBranchRows.every((t) => t.branchId === branch.id),
      `rows=${fBranchRows.length}`,
    )
    if (fBranchRows[0]) {
      const qr = await api(owner, `/api/admin/tables/${fBranchRows[0].id}/qr?format=dataurl`)
      check('QR viewable for filtered branch table', qr.status === 200 && !!qr.json?.dataUrl)
    }

    const fNone = await api(owner, '/api/admin/tables?branchId=none')
    const noneRows: any[] = fNone.json || []
    check(
      'tables ?branchId=none → fixture branchless table present, all rows branchless',
      fNone.status === 200 &&
        noneRows.some((t) => t.id === branchlessTable.id) &&
        noneRows.every((t) => t.branchId == null),
      `rows=${noneRows.length}`,
    )

    const covered = branches.reduce(
      async (accP, b) => {
        const acc = await accP
        const f = await api(owner, `/api/admin/tables?branchId=${b.id}`)
        const rows: any[] = f.json || []
        return acc + (f.status === 200 ? rows.length : 0)
      },
      Promise.resolve(0),
    )
    const coveredCount = await covered
    check(
      'partition: Σ per-branch + none == all (tables)',
      coveredCount + noneRows.length === tables.length,
      `covered=${coveredCount} none=${noneRows.length} all=${tables.length}`,
    )

    const badTable = await api(owner, '/api/admin/tables?branchId=zzz-invalid-branch')
    check('tables invalid branchId → 422', badTable.status === 422, `got ${badTable.status}`)

    // -------------------------------------------------------------- orders
    const allOrders = await api(owner, '/api/admin/orders?pageSize=100')
    const orders: any[] = allOrders.json?.orders || []
    check('orders list loads', allOrders.status === 200 && Array.isArray(orders))

    const of1 = await api(owner, `/api/admin/orders?branchId=${branch.id}&pageSize=100`)
    const oBranchRows: any[] = of1.json?.orders || []
    check(
      'orders ?branchId=<test branch> → fixture order present, all rows in branch',
      of1.status === 200 &&
        oBranchRows.some((o) => o.id === branchOrder.id) &&
        oBranchRows.every((o) => o.branchId === branch.id),
      `rows=${oBranchRows.length}`,
    )

    const of2 = await api(owner, '/api/admin/orders?branchId=none&pageSize=100')
    const oNoneRows: any[] = of2.json?.orders || []
    check(
      'orders ?branchId=none → fixture branchless order present, all rows branchless',
      of2.status === 200 &&
        oNoneRows.some((o) => o.id === branchlessOrder.id) &&
        oNoneRows.every((o) => o.branchId == null),
      `rows=${oNoneRows.length}`,
    )

    if (orders.length < 100) {
      let oCovered = 0
      for (const b of branches) {
        const f = await api(owner, `/api/admin/orders?branchId=${b.id}&pageSize=100`)
        oCovered += (f.json?.orders || []).length
      }
      check(
        'partition: Σ per-branch + none == all (orders)',
        oCovered + oNoneRows.length === orders.length,
        `covered=${oCovered} none=${oNoneRows.length} all=${orders.length}`,
      )
    } else {
      console.log('  SKIP  orders partition check (≥100 orders, paginated)')
    }

    const badOrder = await api(owner, '/api/admin/orders?branchId=zzz-invalid-branch')
    check('orders invalid branchId → 422', badOrder.status === 422, `got ${badOrder.status}`)

    // ---------------------------------------------------------- super admin
    try {
      const sa = await login('admin@platform.com', 'password123')
      const saTables = await api(sa, `/api/admin/tables?restaurantId=${fx.restaurantId}&branchId=${branch.id}`)
      const saRows: any[] = saTables.json || []
      check(
        'super-admin tenant-scoped tables ?branchId= works',
        saTables.status === 200 &&
          saRows.some((t) => t.id === branchTable.id) &&
          saRows.every((t) => t.branchId === branch.id),
      )
      const saOrders = await api(sa, `/api/admin/orders?restaurantId=${fx.restaurantId}&branchId=${branch.id}&pageSize=100`)
      const saORows: any[] = saOrders.json?.orders || []
      check(
        'super-admin tenant-scoped orders ?branchId= works',
        saOrders.status === 200 && saORows.every((o) => o.branchId === branch.id),
      )
    } catch {
      console.log('  SKIP  super-admin checks (account unavailable)')
    }

    // -------------------------------------------------------------- manager
    try {
      const mgr = await login('manager@spicegarden.in', 'password123')
      const mgrAll = await api(mgr, '/api/admin/tables')
      const mgrRows: any[] = mgrAll.json || []
      check('manager tables list loads (own branch)', mgrAll.status === 200)
      const ownBranchId = mgrRows[0]?.branchId
      // Try to leak the TEST branch's tables via the new param — server must win.
      const mgrFiltered = await api(mgr, `/api/admin/tables?branchId=${branch.id}`)
      const mgrFRows: any[] = mgrFiltered.json || []
      check(
        'manager tables ?branchId=<other> IGNORED (own-branch set, no leak)',
        mgrFiltered.status === 200 &&
          mgrFRows.every((t) => t.branchId === ownBranchId) &&
          !mgrFRows.some((t) => t.branchId === branch.id),
        `rows=${mgrFRows.length} leaked=${mgrFRows.filter((t) => t.branchId === branch.id).length}`,
      )
      const mgrOrders = await api(mgr, `/api/admin/orders?branchId=${branch.id}&pageSize=100`)
      const mgrORows: any[] = mgrOrders.json?.orders || []
      check(
        'manager orders ?branchId=<other> IGNORED (no leak)',
        mgrOrders.status === 200 &&
          mgrORows.every((o) => o.branchId === ownBranchId) &&
          !mgrORows.some((o) => o.id === branchOrder.id),
        `leaked=${mgrORows.filter((o) => o.id === branchOrder.id).length}`,
      )
    } catch {
      console.log('  SKIP  manager checks (account unavailable)')
    }
  } finally {
    await cleanupFixtures(fx.restaurantId)
    console.log('        fixtures cleaned up')
  }

  console.log(`\n${pass} passed, ${failCount} failed`)
  process.exit(failCount > 0 ? 1 : 0)
}

main()
  .catch((e) => {
    console.error('E2E crashed:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
