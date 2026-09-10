/**
 * E2E: delete options for QR tables / menu categories / staff
 * Roles covered: RESTAURANT_OWNER, MANAGER, SUPER_ADMIN, WAITER (denial)
 *
 * Verifies:
 *  1. Owner can delete an empty category; a category with items is refused (409)
 *  2. Owner can delete a table that HAS orders — order history is preserved (tableId -> null)
 *  3. Manager can delete their branch's table + staff (staff = soft delete / deactivate)
 *  4. Super admin can delete tables/categories via the ?restaurantId= tenant path
 *  5. WAITER is denied table/staff deletion (403 — RBAC TABLE.DELETE / STAFF.DELETE)
 *
 * Run: DATABASE_URL from .env; dev server must be on localhost:3000
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

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

interface Session {
  cookie: string
  csrf: string
}

async function login(email: string, password: string): Promise<Session> {
  const r1 = await fetch(`${BASE}/api/auth/csrf`)
  const csrfJson = (await r1.json()) as { csrfToken: string }
  const setCookies1 = r1.headers.getSetCookie?.() || []
  const csrfCookie = setCookies1.map((c) => c.split(';')[0]).join('; ')
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken: csrfJson.csrfToken,
      email,
      password,
      json: 'true',
    }),
    redirect: 'manual',
  })
  const setCookies2 = r2.headers.getSetCookie?.() || []
  const sessionCookie = setCookies2
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session-token'))
    .join('; ')
  const cookie = [csrfCookie, sessionCookie].filter(Boolean).join('; ')
  return { cookie, csrf: csrfJson.csrfToken }
}

async function api(
  sess: Session,
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: sess.cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* empty */
  }
  // API responses are wrapped as { success, data } — unwrap for callers
  return { status: res.status, json: json && typeof json === 'object' && 'data' in json ? json.data : json }
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase()

  // ------------------------------------------------------------------
  // Seed a known tenant state via Prisma (spicegarden)
  // ------------------------------------------------------------------
  const restaurant = await db.restaurant.findUnique({
    where: { slug: 'spice-garden' },
  })
  if (!restaurant) throw new Error('spice-garden tenant not found — run seed')

  // Idempotent cleanup of leftovers from previous E2E runs
  await db.order.deleteMany({ where: { restaurantId: restaurant.id, orderNumber: { startsWith: 'E2E-' } } })
  await db.customer.deleteMany({ where: { restaurantId: restaurant.id, name: 'E2E Cust' } })
  await db.menuItem.deleteMany({ where: { restaurantId: restaurant.id, name: { startsWith: 'E2E-' } } })
  await db.menuCategory.deleteMany({ where: { restaurantId: restaurant.id, name: { startsWith: 'E2E-' } } })
  await db.table.deleteMany({ where: { restaurantId: restaurant.id, number: { startsWith: 'E2E-' } } })
  const staleUsers = await db.user.findMany({ where: { email: { startsWith: 'e2e-del-' } } })
  for (const su of staleUsers) {
    await db.auditLog.deleteMany({ where: { userId: su.id } })
    await db.user.delete({ where: { id: su.id } }).catch(() => {})
  }

  const hash = await bcrypt.hash('password123', 10)

  // Logins
  const owner = await login('owner@spicegarden.in', 'password123')
  const manager = await login('manager@spicegarden.in', 'password123')
  const waiter = await login('waiter1@spicegarden.in', 'password123')
  const superAdmin = await login('admin@platform.com', 'password123')
  check('owner logged in', !!owner.cookie.includes('session-token'))
  check('manager logged in', !!manager.cookie.includes('session-token'))
  check('waiter logged in', !!waiter.cookie.includes('session-token'))
  check('super admin logged in', !!superAdmin.cookie.includes('session-token'))

  // ==================================================================
  // 1. OWNER — categories
  // ==================================================================
  console.log('\n[1] OWNER: category delete rules')
  const cat = await api(owner, '/api/admin/menu/categories', 'POST', {
    name: `E2E-DEL-${stamp}`,
  })
  check('owner creates category', cat.status === 201 || cat.status === 200, `status=${cat.status}`)

  const item = await api(owner, '/api/admin/menu/items', 'POST', {
    name: `E2E-ITEM-${stamp}`,
    description: 'temp',
    categoryId: cat.json.id,
    isVeg: true,
    basePrice: 10,
    taxRate: 0.05,
    prepTime: 5,
  })
  check('owner creates item in category', item.status === 201 || item.status === 200, `status=${item.status}`)

  const blockedDel = await api(owner, `/api/admin/menu/categories/${cat.json.id}`, 'DELETE')
  check(
    'category WITH items refused (409)',
    blockedDel.status === 409,
    `status=${blockedDel.status} body=${JSON.stringify(blockedDel.json)}`,
  )

  await api(owner, `/api/admin/menu/items/${item.json.id}`, 'DELETE')
  const okDel = await api(owner, `/api/admin/menu/categories/${cat.json.id}`, 'DELETE')
  check('empty category deleted', okDel.status === 200 && okDel.json?.deleted === true, `status=${okDel.status}`)

  // ==================================================================
  // 2. OWNER — table with order history survives delete
  // ==================================================================
  console.log('\n[2] OWNER: table delete preserves order history')
  const table = await db.table.create({
    data: {
      number: `E2E-${stamp}`,
      capacity: 2,
      restaurantId: restaurant.id,
      qrCodeToken: `e2e-${stamp.toLowerCase()}-a`,
      approvalStatus: 'APPROVED',
    },
  })
  const cust = await db.customer.create({
    data: { restaurantId: restaurant.id, name: 'E2E Cust', phone: `999${stamp.slice(-7)}` },
  })
  const order = await db.order.create({
    data: {
      orderNumber: `E2E-${stamp}`,
      restaurantId: restaurant.id,
      tableId: table.id,
      customerId: cust.id,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: 100,
      grandTotal: 105,
    },
  })
  const delTable = await api(owner, `/api/admin/tables/${table.id}`, 'DELETE')
  check(
    'table WITH orders deleted OK (SetNull)',
    delTable.status === 200 && delTable.json?.deleted === true,
    `status=${delTable.status} body=${JSON.stringify(delTable.json)}`,
  )
  const orderAfter = await db.order.findUnique({ where: { id: order.id } })
  check('order SURVIVES table delete', !!orderAfter)
  check('order.tableId now null', orderAfter?.tableId === null, `tableId=${orderAfter?.tableId}`)

  // ==================================================================
  // 3. MANAGER — table + staff (soft delete)
  // ==================================================================
  console.log('\n[3] MANAGER: branch table + staff deletion')
  const mTable = await api(manager, '/api/admin/tables', 'POST', {
    number: `E2E-M-${stamp}`,
    capacity: 4,
  })
  check('manager creates branch table', mTable.status === 201 || mTable.status === 200, `status=${mTable.status}`)
  const mDel = await api(manager, `/api/admin/tables/${mTable.json.id}`, 'DELETE')
  check('manager deletes branch table', mDel.status === 200 && mDel.json?.deleted === true, `status=${mDel.status}`)

  const mStaff = await api(manager, '/api/admin/staff', 'POST', {
    name: `E2E Staff ${stamp}`,
    email: `e2e-del-${stamp}@spicegarden.in`,
    password: 'password123',
    role: 'WAITER',
  })
  check('manager creates staff (pending)', mStaff.status === 201 || mStaff.status === 200, `status=${mStaff.status}`)
  const mStaffDel = await api(manager, `/api/admin/staff/${mStaff.json.id}`, 'DELETE')
  check(
    'manager removes staff (soft delete)',
    mStaffDel.status === 200 && mStaffDel.json?.deactivated === true,
    `status=${mStaffDel.status} body=${JSON.stringify(mStaffDel.json)}`,
  )
  const staffAfter = await db.user.findUnique({ where: { id: mStaff.json.id } })
  check('staff deactivated not destroyed (audit trail)', staffAfter?.active === false)
  // cleanup temp user completely (test pollution only)
  await db.auditLog.deleteMany({ where: { userId: mStaff.json.id } })
  await db.user.delete({ where: { id: mStaff.json.id } }).catch(() => {})

  // ==================================================================
  // 4. SUPER ADMIN — tenant-scoped deletes
  // ==================================================================
  console.log('\n[4] SUPER ADMIN: tenant-scoped deletes')
  const sTable = await api(superAdmin, `/api/admin/tables?restaurantId=${restaurant.id}`, 'POST', {
    number: `E2E-SA-${stamp}`,
    capacity: 2,
  })
  check('super admin creates table in tenant', sTable.status === 201 || sTable.status === 200, `status=${sTable.status}`)
  if (sTable.json?.id) {
    const sDel = await api(superAdmin, `/api/admin/tables/${sTable.json.id}?restaurantId=${restaurant.id}`, 'DELETE')
    check('super admin deletes tenant table', sDel.status === 200 && sDel.json?.deleted === true, `status=${sDel.status}`)
  }

  const sCat = await api(superAdmin, `/api/admin/menu/categories?restaurantId=${restaurant.id}`, 'POST', {
    name: `E2E-SA-CAT-${stamp}`,
  })
  check('super admin creates tenant category', sCat.status === 201 || sCat.status === 200, `status=${sCat.status}`)
  if (sCat.json?.id) {
    const sCatDel = await api(
      superAdmin,
      `/api/admin/menu/categories/${sCat.json.id}?restaurantId=${restaurant.id}`,
      'DELETE',
    )
    check('super admin deletes tenant category', sCatDel.status === 200 && sCatDel.json?.deleted === true, `status=${sCatDel.status}`)
  }

  // ==================================================================
  // 5. WAITER — denied (RBAC)
  // ==================================================================
  console.log('\n[5] WAITER: delete denied (403)')
  const wTable = await db.table.create({
    data: {
      number: `E2E-W-${stamp}`,
      capacity: 2,
      restaurantId: restaurant.id,
      qrCodeToken: `e2e-${stamp.toLowerCase()}-w`,
      approvalStatus: 'APPROVED',
    },
  })
  const wDel = await api(waiter, `/api/admin/tables/${wTable.id}`, 'DELETE')
  check('waiter table delete denied', wDel.status === 403, `status=${wDel.status}`)
  const anyStaff = await db.user.findFirst({
    where: { restaurantId: restaurant.id, role: 'WAITER', active: true },
  })
  const wStaffDel = await api(waiter, `/api/admin/staff/${anyStaff?.id}`, 'DELETE')
  check('waiter staff delete denied', wStaffDel.status === 403, `status=${wStaffDel.status}`)

  // cleanup waiter table
  await db.table.delete({ where: { id: wTable.id } })

  // ==================================================================
  // Cleanup remaining E2E rows (order + customer are test artifacts)
  // ==================================================================
  await db.order.delete({ where: { id: order.id } }).catch(() => {})
  await db.customer.delete({ where: { id: cust.id } }).catch(() => {})

  console.log(`\n===== RESULT: ${pass} passed, ${failCount} failed =====`)
  await db.$disconnect()
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('E2E fatal:', e)
  await db.$disconnect()
  process.exit(1)
})
