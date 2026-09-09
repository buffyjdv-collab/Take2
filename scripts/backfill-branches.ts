/**
 * Backfill branches — one-time migration helper.
 *
 * The Branch model was added to the schema after the platform launched, so
 * existing tenants have tables/orders with branchId = null. This script:
 *
 *   1. Creates a "Main Branch" for every restaurant that has no branches yet.
 *   2. Attaches all of that restaurant's tables (branchId = null) to it.
 *   3. Backfills orders' branchId from their table's branch (where null).
 *
 * Idempotent — safe to run multiple times.
 *
 * Run via:  DATABASE_URL="postgresql://…" bun run scripts/backfill-branches.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const restaurants = await db.restaurant.findMany({
    select: { id: true, name: true },
  })
  console.log(`Restaurants: ${restaurants.length}`)

  let createdBranches = 0
  let attachedTables = 0
  let backfilledOrders = 0

  for (const r of restaurants) {
    // 1. Ensure at least one branch exists
    let branch = await db.branch.findFirst({
      where: { restaurantId: r.id },
      orderBy: { createdAt: 'asc' },
    })
    if (!branch) {
      branch = await db.branch.create({
        data: {
          restaurantId: r.id,
          name: 'Main Branch',
          address: '—', // owner can edit it in Branches
          active: true,
        },
      })
      createdBranches++
      console.log(`  + created "Main Branch" for ${r.name}`)
    }

    // 2. Attach unassigned tables
    const tables = await db.table.updateMany({
      where: { restaurantId: r.id, branchId: null },
      data: { branchId: branch.id },
    })
    attachedTables += tables.count
    if (tables.count > 0) {
      console.log(`  + attached ${tables.count} table(s) of ${r.name} to ${branch.name}`)
    }

    // 3. Backfill order branchId from their table
    const orders = await db.order.updateMany({
      where: { restaurantId: r.id, branchId: null, table: { branchId: { not: null } } },
      data: { branchId: branch.id },
    })
    backfilledOrders += orders.count
    if (orders.count > 0) {
      console.log(`  + backfilled ${orders.count} order(s) of ${r.name}`)
    }
  }

  console.log(
    `\nDone — branches created: ${createdBranches}, tables attached: ${attachedTables}, orders backfilled: ${backfilledOrders}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
