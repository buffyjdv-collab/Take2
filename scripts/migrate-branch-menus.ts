/**
 * One-time migration to the STRICT branch-menu model.
 *
 *   Each branch's QR menu shows ONLY its own categories/items. The
 *   "main menu" is whatever belongs to the branch the restaurant owner's
 *   account is bound to (their main location). Restaurant-wide (branchId =
 *   null) content therefore belongs to that main branch.
 *
 * Steps per restaurant:
 *   1. Find the main branch M = branch of the restaurant's RESTAURANT_OWNER.
 *      (Skip restaurants whose owner is not bound to a branch.)
 *   2. Re-assign branchId = null categories/items -> M.
 *   3. Orphan repair: items whose branchId differs from their category's
 *      branch get re-parented into a same-named mirror category under the
 *      item's own branch (manager-created items that were filed under
 *      another branch's / restaurant-wide categories).
 *
 * Run with --dry to preview. Idempotent: re-running makes no further changes.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const dry = process.argv.includes('--dry')

function randomSuffix(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

async function migrateRestaurant(r: { id: string; name: string }) {
  const owner = await db.user.findFirst({
    where: { restaurantId: r.id, role: 'RESTAURANT_OWNER' },
    orderBy: { createdAt: 'asc' },
  })
  const mainBranchId = owner?.branchId ?? null
  if (!mainBranchId) {
    console.log(`\n[${r.name}] SKIP — owner not bound to any branch; restaurant-wide menu stays as-is.`)
    return
  }
  const mainBranch = await db.branch.findUnique({ where: { id: mainBranchId } })
  console.log(`\n[${r.name}] main branch = "${mainBranch?.name}" (${mainBranchId})`)

  // 2. Restaurant-wide categories & items -> main branch
  if (!dry) {
    const cats = await db.menuCategory.updateMany({
      where: { restaurantId: r.id, branchId: null },
      data: { branchId: mainBranchId },
    })
    const items = await db.menuItem.updateMany({
      where: { restaurantId: r.id, branchId: null },
      data: { branchId: mainBranchId },
    })
    console.log(`  moved ${cats.count} restaurant-wide categories -> main branch`)
    console.log(`  moved ${items.count} restaurant-wide items -> main branch`)
  } else {
    const catCount = await db.menuCategory.count({ where: { restaurantId: r.id, branchId: null } })
    const itemCount = await db.menuItem.count({ where: { restaurantId: r.id, branchId: null } })
    console.log(`  [dry] would move ${catCount} categories + ${itemCount} items -> main branch`)
  }

  // 3. Orphan repair: item.branchId != category.branchId
  const allItems = await db.menuItem.findMany({
    where: { restaurantId: r.id },
    include: { category: true },
  })
  for (const item of allItems) {
    if (!item.branchId || item.branchId === item.category.branchId) continue
    const targetBranch = await db.branch.findUnique({ where: { id: item.branchId } })
    console.log(
      `  orphan item "${item.name}" (branch "${targetBranch?.name}") sits under category "${item.category.name}" (branch "${item.category.branchId ? (await db.branch.findUnique({ where: { id: item.category.branchId } }))?.name : 'restaurant-wide'}")`,
    )
    if (dry) {
      console.log(`    [dry] would create mirror category "${item.category.name}" under "${targetBranch?.name}" and re-parent the item`)
      continue
    }
    let mirror = await db.menuCategory.findFirst({
      where: { restaurantId: r.id, branchId: item.branchId, name: item.category.name },
    })
    if (!mirror) {
      mirror = await db.menuCategory.create({
        data: {
          restaurantId: r.id,
          branchId: item.branchId,
          name: item.category.name,
          description: item.category.description,
          icon: item.category.icon,
          sortOrder: item.category.sortOrder,
          active: true,
          approvalStatus: 'APPROVED',
        },
      })
      console.log(`    created mirror category "${mirror.name}" (APPROVED) under "${targetBranch?.name}"`)
    }
    await db.menuItem.update({ where: { id: item.id }, data: { categoryId: mirror.id } })
    console.log(`    re-parented item "${item.name}"`)
  }
}

async function main() {
  const restaurants = await db.restaurant.findMany({ select: { id: true, name: true } })
  console.log(`=== STRICT BRANCH MENU MIGRATION ${dry ? '(DRY RUN)' : ''} ===`)
  for (const r of restaurants) await migrateRestaurant(r)
  if (!dry) {
    // sanity: no orphans remain
    const items = await db.menuItem.findMany({ include: { category: true } })
    const orphans = items.filter((i) => i.branchId && i.branchId !== i.category.branchId)
    console.log(`\n=== SANITY: ${orphans.length} orphan items remain (must be 0) ===`)
  }
}

main().finally(() => db.$disconnect())
